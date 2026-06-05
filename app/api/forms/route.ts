import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, tenants, contacts, formSubmissions, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';

export async function POST(req: NextRequest) {
  try {
    const limited = await checkRateLimit(req, { action: 'form_submit', max: 20, windowMinutes: 60 });
    if (limited) return limited;
    
    const body = await req.json();
    const { form_id, data: formData = {} } = body;
    if (!form_id) return NextResponse.json({ error: 'form_id required' }, { status: 400 });

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
    if (!form) return NextResponse.json({ error: 'Form not found or inactive' }, { status: 404 });
    
    if (!['active', 'trialing'].includes(form.tenant_status || '')) {
      return NextResponse.json({ ok: true, message: (form.settings as any)?.success_message ?? 'Thank you!' });
    }

    const email = formData.email?.trim()?.toLowerCase();
    let contact_id: string | null = null;
    
    if (email) {
      const existing = await db.query.contacts.findFirst({
        where: and(
          eq(contacts.tenantId, form.tenantId),
          eq(contacts.email, email),
          eq(contacts.isArchived, false)
        )
      });

      if (existing) {
        contact_id = existing.id;
      } else {
        const [c] = await db.insert(contacts).values({
          tenantId: form.tenantId,
          firstName: formData.first_name?.trim() ?? '',
          lastName: formData.last_name?.trim() ?? '',
          email,
          phone: formData.phone?.trim() ?? null,
          leadStatus: 'new',
          leadSource: `Form: ${form.name}`,
          notes: formData.message?.trim() ?? null,
        }).returning({ id: contacts.id });
        contact_id = c?.id ?? null;
      }
    }

    await db.insert(formSubmissions).values({
      tenantId: form.tenantId,
      formId: form_id,
      contactId: contact_id,
      data: formData,
      sourceUrl: req.headers.get('referer') ?? null,
      submittedBy: req.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
    });

    await db.update(forms)
      .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
      .where(eq(forms.id, form_id))
      .catch(() => {});

    if (form.owner_id && contact_id) {
      await createNotification({
        userId: form.owner_id, tenantId: form.tenantId, type: 'system',
        title: `New form submission: ${form.name}`,
        body: email ? `From: ${email}` : undefined,
        link: `/tenant/contacts/${contact_id}`,
      });
    }

    await fireWebhooks(form.tenantId, 'contact.created', { form_id, contact_id, ...formData }).catch(() => {});
    return NextResponse.json({ ok: true, message: (form.settings as any)?.success_message ?? 'Thank you! We will be in touch.' });
  } catch (err: any) {
    console.error('[forms] Submission error:', err);
    return NextResponse.json({ ok: true, message: 'Thank you! Your submission has been received.' });
  }
}
