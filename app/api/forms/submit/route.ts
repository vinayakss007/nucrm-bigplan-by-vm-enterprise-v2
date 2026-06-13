import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, tenants, contacts, formSubmissions, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';
import { syncCalculatedFields } from '@/lib/formula/sync';

export async function POST(req: NextRequest) {
  try {
    // 1. Rate Limiting (IP-based)
    const limited = await checkRateLimit(req, { action: 'form_submit', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const body = await requestToJson(req);
    // Support both 'data' and 'values' keys from frontend
    const { form_id, data: d1 = {}, values: d2 = {} } = body;
    const formData = Object.keys(d1).length > 0 ? d1 : d2;

    if (!form_id) return NextResponse.json({ error: 'Form ID is required' }, { status: 400 });

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
    // Look for email in various possible keys
    const email = (formData.email || formData.email_address || formData.Email || '').trim().toLowerCase();
    const message = formData.message || formData.notes || formData.Message || null;
    let contactId: string | null = null;

    if (email) {
      const existing = await db.query.contacts.findFirst({
        where: and(eq(contacts.tenantId, form.tenantId), eq(contacts.email, email), isNull(contacts.deletedAt))
      });

      if (existing) {
        contactId = existing.id;
        // Update contact with new data from form
        const currentTags = (existing.tags as string[]) || [];
        const newTags = Array.from(new Set([...currentTags, 'Form Submission', `Form: ${form.name}`]));
        
        await db.update(contacts)
          .set({ tags: newTags, updatedAt: new Date() })
          .where(eq(contacts.id, contactId));

        // Log activity for existing contact
        await db.insert(activities).values({
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
        // Create new contact
        const firstName = formData.first_name || formData.first_name || formData.name?.split(' ')[0] || 'Unknown';
        const lastName = formData.last_name || formData.name?.split(' ').slice(1).join(' ') || 'Lead';
        
        const [newContact] = await db.insert(contacts)
          .values({
            tenantId: form.tenantId,
            firstName,
            lastName,
            email,
            phone: formData.phone || formData.phone_number || null,
            leadStatus: 'new',
            leadSource: `Form: ${form.name}`,
            notes: message,
            tags: ['New Lead', 'Form Submission', `Form: ${form.name}`]
          })
          .returning({ id: contacts.id });
        
        contactId = newContact?.id || null;

        // Log initial activity
        if (contactId) {
          await db.insert(activities).values({
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
      await db.insert(activities).values({
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
    await db.insert(formSubmissions).values({
      tenantId: form.tenantId,
      formId: form.id,
      contactId,
      data: formData,
      submittedBy: req.headers.get('x-forwarded-for')?.split(',')[0] || null
    });

    // 5. Update submission count
    await db.update(forms)
      .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
      .where(eq(forms.id, form.id))
      .catch(async (err) => {
        console.warn('[FormsSubmit] failed to update submissionsCount:', err.message);
        // Fallback or retry logic if needed, but in Drizzle the column name should be fixed
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
      message: (form.settings as Record<string, unknown>)?.['success_message'] as string || 'Thank you! Your submission has been received.' 
    });

  } catch (err: any) {
    console.error('[FormsSubmit] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function requestToJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    throw new Error('Invalid JSON in request body');
  }
}
