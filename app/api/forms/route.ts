/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { forms, tenants, contacts, formSubmissions } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';
import { validateBody, readJsonBody } from '@/lib/api/validate';

const formSubmitSchema = z.object({
  form_id: z.string().min(1, 'Form ID is required'),
  data: z.record(z.string(), z.unknown()).optional().default({}),
});

function escapeHtmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

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
      sanitized[key] = sanitizeFormData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export async function POST(req: NextRequest) {
  try {
    const limited = await checkRateLimit(req, { action: 'form_submit', max: 20, windowMinutes: 60 });
    if (limited) return limited;

    const body = await readJsonBody(req);
    const validated = validateBody(formSubmitSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { form_id, data: rawData } = validated.data;
    const formData = sanitizeFormData(rawData as Record<string, unknown>) as Record<string, string | undefined>;

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
      return NextResponse.json({ ok: true, message: (form.settings as Record<string, unknown>)?.success_message as string ?? 'Thank you!' });
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

    await db.transaction(async (tx) => {
      await tx.insert(formSubmissions).values({
        tenantId: form.tenantId,
        formId: form_id,
        contactId: contact_id,
        data: formData,
        sourceUrl: req.headers.get('referer') ?? null,
        submittedBy: req.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
      });

      await tx.update(forms)
        .set({ submissionsCount: sql`${forms.submissionsCount} + 1` })
        .where(eq(forms.id, form_id));
    });

    if (form.owner_id && contact_id) {
      await createNotification({
        userId: form.owner_id, tenantId: form.tenantId, type: 'system',
        title: `New form submission: ${form.name}`,
        body: email ? `From: ${email}` : undefined,
        link: `/tenant/contacts/${contact_id}`,
      });
    }

    await fireWebhooks(form.tenantId, 'contact.created', { form_id, contact_id, ...formData }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    return NextResponse.json({ ok: true, message: (form.settings as Record<string, unknown>)?.success_message as string ?? 'Thank you! We will be in touch.' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[forms] Submission error:', err);
    return NextResponse.json({ ok: true, message: 'Thank you! Your submission has been received.' });
  }
}
