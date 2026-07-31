import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, tenants, contacts, formSubmissions, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';
import { syncCalculatedFields } from '@/lib/formula/sync';
import { validateBody, readJsonBody } from '@/lib/api/validate';

const formSubmitSchema = z.object({
  form_id: z.string().min(1, 'Form ID is required'),
  data: z.record(z.string(), z.unknown()).optional().default({}),
  values: z.record(z.string(), z.unknown()).optional().default({}),
});

/**
 * Escape HTML entities in a string to prevent XSS when values are rendered.
 */
function escapeHtmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Recursively sanitize all string values in an object to prevent stored XSS.
 */
function sanitizeFormData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = escapeHtmlEntities(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'string' ? escapeHtmlEntities(item) : item
      );
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Rate Limiting (IP-based)
    const limited = await checkRateLimit(req, { action: 'form_submit', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const body = await requestToJson(req);
    const validated = validateBody(formSubmitSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { form_id, data: d1, values: d2 } = v;
    const rawFormData = Object.keys(d1).length > 0 ? d1 : d2;
    const formData = sanitizeFormData(rawFormData as Record<string, unknown>);

    // 2. Fetch form and tenant context
    const formResult = await db.select({
      id: forms.id,
      tenantId: forms.tenantId,
      name: forms.name,
      isActive: forms.isActive,
      settings: forms.settings,
      owner_id: tenants.ownerId,
      tenant_status: tenants.status
    })
    .from(forms)
    .innerJoin(tenants, eq(tenants.id, forms.tenantId))
    .where(and(eq(forms.id, form_id), eq(forms.isActive, true)))
    .limit(1);

    const form = formResult[0];

    if (!form) {
      return NextResponse.json({ error: 'Form not found or inactive' }, { status: 404 });
    }

    // 3. Process contact creation/update
    const email = String(formData.email || formData.email_address || formData.Email || '').trim().toLowerCase();
    const message = String(formData.message || formData.notes || formData.Message || '');
    let contactId: string | null = null;

    await db.transaction(async (tx) => {
      if (email) {
        const existing = await db.query.contacts.findFirst({
          where: and(eq(contacts.tenantId, form.tenantId), eq(contacts.email, email), isNull(contacts.deletedAt))
        });

        if (existing) {
          contactId = existing.id;
          const currentTags = (existing.tags as string[]) || [];
          const newTags = Array.from(new Set([...currentTags, 'Form Submission', `Form: ${form.name}`]));
          
          await tx.update(contacts)
            .set({ tags: newTags, updatedAt: new Date() })
            .where(eq(contacts.id, contactId));

          await tx.insert(activities).values({
            tenantId: form.tenantId,
            contactId: contactId,
            eventType: 'note',
            metadata: { 
              message: `Form "${form.name}" submitted again`,
              form_id: form.id, 
              ...formData 
            },
            entityType: 'contact',
            entityId: contactId,
            action: 'form_submission',
            description: `Submitted form "${form.name}"`
          });
        } else {
          const name = String(formData.name || '');
          const firstName = String(formData.first_name || name.split(' ')[0] || 'Unknown');
          const lastName = String(formData.last_name || name.split(' ').slice(1).join(' ') || 'Lead');

          const [newContact] = await tx.insert(contacts)
            .values({
              tenantId: form.tenantId,
              firstName,
              lastName,
              email,
              phone: String(formData.phone || formData.phone_number || ''),
              leadStatus: 'new',
              leadSource: `Form: ${form.name}`,
              notes: message,
              tags: ['New Lead', 'Form Submission', `Form: ${form.name}`]
            })
            .returning({ id: contacts.id });
          
          contactId = newContact?.id || null;

          if (contactId) {
            await tx.insert(activities).values({
              tenantId: form.tenantId,
              contactId: contactId,
              eventType: 'note',
              metadata: {
                message: `Initial capture via form "${form.name}"`,
                form_id: form.id,
                ...formData
              },
              entityType: 'contact',
              entityId: contactId,
              action: 'form_submission',
              description: `Captured via form "${form.name}"`
            });
          }
        }
      }

      // Save message as a separate note if present
      if (contactId && message) {
        await tx.insert(activities).values({
          tenantId: form.tenantId,
          contactId: contactId,
          eventType: 'note',
          metadata: {
            message: message,
            form_id: form.id,
            form_name: form.name
          },
          entityType: 'contact',
          entityId: contactId,
          action: 'form_message',
          description: `Sent message via form "${form.name}"`
        }).catch(err => console.error('[FormsSubmit] failed to save note:', err));
      }

      // 4. Record the submission
      await tx.insert(formSubmissions).values({
        tenantId: form.tenantId,
        formId: form.id,
        contactId,
        data: formData,
        submittedBy: req.headers.get('x-forwarded-for')?.split(',')[0] || null
      });

      // 5. Update submission count
      await tx.update(forms)
        .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
        .where(eq(forms.id, form.id))
        .catch(async (err) => {
          console.warn('[FormsSubmit] failed to update submissionsCount:', err.message);
        });
    });


    // 6. Trigger Calculations & Automations
    if (contactId) {
      // Recalculate formula fields for the contact
      const fullContact = await db.query.contacts.findFirst({
        where: eq(contacts.id, contactId)
      });
      if (fullContact) {
        await syncCalculatedFields(form.tenantId, 'contact', contactId, fullContact);
      }

      // Trigger "Form Submitted" webhook/automation
      await fireWebhooks(form.tenantId, 'contact.created', { 
        form_id: form.id, 
        form_name: form.name,
        contact_id: contactId,
        ...formData 
      }).catch(console.error);

      // Notify owner
      if (form.owner_id) {
        await createNotification({
          userId: form.owner_id,
          tenantId: form.tenantId,
          type: 'system',
          title: `New Lead: ${form.name}`,
          body: `A new response was submitted by ${email || 'anonymous user'}.`,
          link: `/tenant/contacts/${contactId}`
        }).catch(console.error);
      }
    }

    return NextResponse.json({ 
      ok: true, 
      message: (form.settings as Record<string, unknown>)?.success_message as string || 'Thank you! Your submission has been received.' 
    });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[FormsSubmit] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function requestToJson(req: NextRequest) {
  try {
    return await readJsonBody(req);
  } catch {
    throw new Error('Invalid JSON in request body');
  }
}
