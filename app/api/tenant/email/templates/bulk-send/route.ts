/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, emailTemplates } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { sendEmail } from '@/lib/email/service';
import { escapeHtml } from '@/lib/email/escape-html';

/**
 * POST /api/tenant/email/templates/bulk-send
 * Send an email template to multiple contacts at once.
 *
 * Body: { template_id: string, contact_ids: string[], variables?: Record<string, string> }
 *
 * Template variables are interpolated: {{first_name}}, {{company}}, etc.
 * Max 50 recipients per request (use multiple requests for larger campaigns).
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'bulk-email', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'contacts.email');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { template_id, contact_ids, variables = {} } = body as {
      template_id?: string;
      contact_ids?: string[];
      variables?: Record<string, string>;
    };

    if (!template_id) return NextResponse.json({ error: 'template_id required' }, { status: 400 });
    if (!contact_ids?.length) return NextResponse.json({ error: 'contact_ids required (min 1)' }, { status: 400 });
    if (contact_ids.length > 50) return NextResponse.json({ error: 'Max 50 recipients per request' }, { status: 400 });

    // Fetch template
    const [template] = await db
      .select()
      .from(emailTemplates)
      .where(and(eq(emailTemplates.id, template_id), eq(emailTemplates.tenantId, ctx.tenantId)))
      .limit(1);

    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    // Fetch contacts - filter out doNotContact contacts
    const recipientContacts = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
      })
      .from(contacts)
      .where(and(
        eq(contacts.tenantId, ctx.tenantId),
        sql`${contacts.id} = ANY(${contact_ids})`,
        sql`${contacts.deletedAt} IS NULL`,
        sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`,
        eq(contacts.doNotContact, false)
      ));

    if (recipientContacts.length === 0) {
      return NextResponse.json({ error: 'No valid recipients found (contacts need email addresses)' }, { status: 400 });
    }

    // Send to each contact with personalization
    const results: Array<{ contact_id: string; email: string; status: 'sent' | 'failed'; error?: string }> = [];

    for (const contact of recipientContacts) {
      try {
        const personalVars: Record<string, string> = {
          ...variables,
          first_name: contact.firstName || '',
          last_name: contact.lastName || '',
          full_name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
          email: contact.email || '',
        };

        const subject = interpolateRaw(template.subject || '', personalVars);
        // emailTemplates stores bodyHtml / bodyText — there is no `body` column.
        // Prefer the HTML body, fall back to the plain-text one.
        const htmlBody = interpolate(template.bodyHtml || template.bodyText || '', personalVars);

        await sendEmail({
          to: contact.email!,
          subject,
          html: htmlBody,
        });

        results.push({ contact_id: contact.id, email: contact.email!, status: 'sent' });
      } catch (err) {
        results.push({
          contact_id: contact.id,
          email: contact.email || '',
          status: 'failed',
          error: err instanceof Error ? err.message : 'Send failed',
        });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return NextResponse.json({
      data: { sent, failed, total: results.length, results },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(vars[key] ?? ''));
}

/** Interpolate without HTML escaping — for plain-text contexts like email subjects */
function interpolateRaw(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
