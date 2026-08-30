/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, emailTemplates } from '@/drizzle/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { addJob } from '@/lib/queue';
import { logAudit } from '@/lib/audit';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const MAX_EMAILS = 50;

export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'bulk', 'post');
  if (limited) return limited;

  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const permErr = requirePerm(ctx, 'contacts.edit');
    if (permErr) return permErr;

    const { entity_type, entity_ids, template_id } = await readJsonBody(req);

    if (!entity_ids?.length || entity_ids.length > MAX_EMAILS) {
      return NextResponse.json({ error: `Max ${MAX_EMAILS} emails per batch` }, { status: 400 });
    }

    const [template] = await db.select().from(emailTemplates)
      .where(and(eq(emailTemplates.id, template_id), eq(emailTemplates.tenantId, ctx.tenantId)))
      .limit(1);
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    // Compliance (#1120): exclude contacts flagged unsubscribed / do-not-contact.
    // doNotContact is filtered in SQL; `unsubscribed` is fetched so we can report
    // exactly how many recipients were skipped for compliance reasons.
    const ents = await db.select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      unsubscribed: contacts.unsubscribed,
    })
      .from(contacts)
      .where(and(
        inArray(contacts.id, entity_ids),
        eq(contacts.tenantId, ctx.tenantId),
        isNull(contacts.deletedAt),
        eq(contacts.doNotContact, false)
      ));

    const skippedUnsubscribed = ents.filter(ent => ent.unsubscribed === true).length;
    const eligible = ents.filter(ent => ent.unsubscribed !== true);

    const recipients = eligible
      .filter(ent => !!ent.email)
      .map(ent => ({
        contact_id: ent.id,
        email: ent.email as string,
        first_name: ent.firstName || '',
        last_name: ent.lastName || '',
      }));

    if (recipients.length === 0) {
      return NextResponse.json({
        error: skippedUnsubscribed > 0
          ? 'All selected contacts are unsubscribed or do not accept marketing email'
          : 'No valid recipients found (contacts need email addresses)',
        queued: false,
        count: 0,
        skipped_unsubscribed: skippedUnsubscribed,
      }, { status: 400 });
    }

    // Normalize {{var}} template tokens to {var} so the send-bulk-emails worker's
    // per-recipient substitution (e.g. {first_name}) applies during delivery.
    const body = (template.bodyHtml || template.bodyText || '').replace(/\{\{(\w+)\}\}/g, '{$1}');

    // Queue instead of sending inline (#1325/#1124): bulk sends previously ran a
    // sequential awaited loop inside the request. The worker processes recipients
    // in parallel batches with retries.
    await addJob('send-bulk-emails', {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      subject: template.subject,
      body,
      recipients,
    });

    console.log(`[email bulk] Queued ${recipients.length} emails for tenant ${ctx.tenantId} ` +
      `(skipped_unsubscribed=${skippedUnsubscribed}, template=${template_id})`);

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'bulk_email',
      entityType: entity_type,
      newData: { queued: recipients.length, skipped_unsubscribed: skippedUnsubscribed, template_id },
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      count: recipients.length,
      skipped_unsubscribed: skippedUnsubscribed,
    });
  } catch (err) {
    void logError({ error: err, context: 'tenant/email/bulk' });
    return NextResponse.json({ error: 'Failed to queue emails' }, { status: 500 });
  }
});
