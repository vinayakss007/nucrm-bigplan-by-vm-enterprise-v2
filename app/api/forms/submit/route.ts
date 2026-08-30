/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
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
 * #1160: given a form's field definitions and the submitted data, return the
 * labels of any required fields that are missing/empty. Pure + exported so it
 * can be unit-tested without the route's DB machinery.
 */
export function findMissingRequiredFields(
  fields: unknown,
  formData: Record<string, unknown>
): string[] {
  const defs = Array.isArray(fields)
    ? (fields as Array<{ key?: string; label?: string; required?: boolean }>)
    : [];
  return defs
    .filter((f) => f && f.required === true && typeof f.key === 'string' && f.key.length > 0)
    .filter((f) => {
      const val = formData[f.key as string];
      return val === undefined || val === null || (typeof val === 'string' && val.trim() === '');
    })
    .map((f) => (f.label as string) || (f.key as string));
}

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
 * Handles nested objects and arrays at any depth.
 */
function sanitizeFormData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = escapeHtmlEntities(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => {
        if (typeof item === 'string') return escapeHtmlEntities(item);
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          return sanitizeFormData(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (value !== null && typeof value === 'object') {
      // Recurse into nested objects to sanitize deeply nested string values
      sanitized[key] = sanitizeFormData(value as Record<string, unknown>);
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

    // #1160: malformed JSON is a client error (400), not a 500.
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
    }
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
      fields: forms.fields,
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

    // #1160: validate the form's own required fields and return 400 (with the
    // list of missing fields) instead of proceeding with incomplete data (which
    // previously succeeded silently or surfaced as a 500 downstream).
    const missing = findMissingRequiredFields(form.fields, formData);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'Missing required fields', fields: missing },
        { status: 400 }
      );
    }

    // 3. Process contact creation/update
    const email = String(formData.email || formData.email_address || formData.Email || '').trim().toLowerCase();
    const message = String(formData.message || formData.notes || formData.Message || '');
    let contactId: string | null = null;

    await db.transaction(async (tx) => {
      if (email) {
        // #1130: read within the transaction (tx.query, not db.query) so the
        // existence check and the insert below see a consistent snapshot and
        // concurrent submissions with the same email don't create duplicates.
        const existing = await tx.query.contacts.findFirst({
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
            // Increment contact counter for newly created contact
            await tx.update(tenants)
              .set({ currentContacts: sql`${tenants.currentContacts} + 1` })
              .where(eq(tenants.id, form.tenantId));
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
        }).catch(err => void logError({ error: err, context: 'forms/submit save-note', tenantId: form.tenantId, level: 'warning' }));
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
      }).catch(err => void logError({ error: err, context: 'forms/submit fire-webhooks', tenantId: form.tenantId, level: 'warning' }));

      // Notify owner
      if (form.owner_id) {
        await createNotification({
          userId: form.owner_id,
          tenantId: form.tenantId,
          type: 'system',
          title: `New Lead: ${form.name}`,
          body: `A new response was submitted by ${email || 'anonymous user'}.`,
          link: `/tenant/contacts/${contactId}`
        }).catch(err => void logError({ error: err, context: 'forms/submit owner-notification', tenantId: form.tenantId, level: 'warning' }));
      }
    }

    return NextResponse.json({ 
      ok: true, 
      message: (form.settings as Record<string, unknown>)?.success_message as string || 'Thank you! Your submission has been received.' 
    });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'forms/submit' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


