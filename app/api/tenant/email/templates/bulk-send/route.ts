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
import { addJob } from '@/lib/queue';
import { escapeHtml } from '@/lib/email/escape-html';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * POST /api/tenant/email/templates/bulk-send
 * Send an email template to multiple contacts at once.
 *
 * Body: { template_id: string, contact_ids: string[], variables?: Record<string, string> }
 *
 * Template variables are interpolated: {{first_name}}, {{company}}, etc.
 * Max 50 recipients per request (use multiple requests for larger campaigns).
 *
 * #1052: instead of sending each email inline inside the HTTP request (an N+1
 * synchronous loop that blocks the request and risks timeout/partial loss),
 * this route now enqueues a single `send-bulk-emails` job — the same queue
 * mechanism the already-fixed app/api/tenant/email/bulk route uses. The worker
 * processes recipients in parallel batches with retries.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
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

    // Fetch contacts - filter out doNotContact contacts.
    // Compliance (#1120): `unsubscribed` is fetched so opted-out contacts can be
    // skipped and reported instead of emailed. Eligibility filtering happens
    // BEFORE enqueuing so the queued job only ever targets valid recipients.
    const recipientContacts = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        unsubscribed: contacts.unsubscribed,
      })
      .from(contacts)
      .where(and(
        eq(contacts.tenantId, ctx.tenantId),
        sql`${contacts.id} = ANY(${contact_ids})`,
        sql`${contacts.deletedAt} IS NULL`,
        sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`,
        eq(contacts.doNotContact, false)
      ));

    const skippedUnsubscribed = recipientContacts.filter(c => c.unsubscribed === true).length;
    const eligibleContacts = recipientContacts.filter(c => c.unsubscribed !== true);

    if (eligibleContacts.length === 0) {
      return NextResponse.json({ error: 'No valid recipients found (contacts need email addresses)' }, { status: 400 });
    }

    // Pre-apply the caller-supplied static `variables` (e.g. {{company}}) that
    // are identical for every recipient, then normalize the remaining
    // per-recipient {{first_name}} token to {first_name} so the send-bulk-emails
    // worker's per-recipient substitution applies during delivery. This mirrors
    // the token contract used by app/api/tenant/email/bulk (worker substitutes
    // {first_name} per recipient). Other per-contact tokens (last_name,
    // full_name) are not substituted by the worker — same limitation as the
    // sibling bulk route.
    // Subject uses raw (unescaped) substitution — plain-text context.
    const subject = normalizeFirstNameToken(applyStaticVars(template.subject || '', variables, false));
    // Body values are HTML-escaped to preserve the anti-XSS behavior the inline
    // implementation had (#1170/#1191/#1272 family). The worker separately
    // escapes the per-recipient first_name.
    const bodyContent = normalizeFirstNameToken(
      applyStaticVars(template.bodyHtml || template.bodyText || '', variables, true)
    );

    // Build the recipient payload shape the send-bulk-emails worker reads
    // ({ email, first_name, last_name }); contact_id is included for parity with
    // the sibling bulk route.
    const recipients = eligibleContacts.map(c => ({
      contact_id: c.id,
      email: c.email as string,
      first_name: c.firstName || '',
      last_name: c.lastName || '',
    }));

    // Queue instead of sending inline (#1052).
    await addJob('send-bulk-emails', {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      subject,
      body: bodyContent,
      recipients,
    });

    return NextResponse.json({
      data: {
        queued: true,
        count: recipients.length,
        skipped_unsubscribed: skippedUnsubscribed,
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

/**
 * Substitute static, recipient-independent variables ({{company}}, etc.) into a
 * template. Leaves the per-recipient {{first_name}} token intact so the worker
 * can substitute it per recipient.
 */
function applyStaticVars(template: string, vars: Record<string, string>, escape: boolean): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key === 'first_name') return match; // handled per-recipient by the worker
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return match;
    const value = String(vars[key] ?? '');
    return escape ? escapeHtml(value) : value;
  });
}

/** Normalize the remaining {{first_name}} token to the worker's {first_name} form. */
function normalizeFirstNameToken(template: string): string {
  return template.replace(/\{\{first_name\}\}/g, '{first_name}');
}
