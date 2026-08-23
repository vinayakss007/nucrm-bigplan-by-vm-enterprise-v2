import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, emailTemplates } from '@/drizzle/schema';
import { eq, and, inArray, isNull } from 'drizzle-orm';
import { sendEmail, renderTemplate, renderTemplateHtml } from '@/lib/email/service';
import { logAudit } from '@/lib/audit';
import { readJsonBody } from '@/lib/api/validate';
import { cache } from '@/lib/cache';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

const MAX_EMAILS = 50;

/**
 * Generate a deterministic batch key for idempotency tracking.
 * Uses tenant + template + sorted contact IDs to identify a unique batch.
 */
function makeBatchKey(tenantId: string, templateId: string, entityIds: string[]): string {
  const sorted = [...entityIds].sort().join(',');
  return `bulk-email:${tenantId}:${templateId}:${sorted}`;
}

export async function POST(req: NextRequest) {
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

    const ents = await db.select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
      .from(contacts)
      .where(and(
        inArray(contacts.id, entity_ids),
        eq(contacts.tenantId, ctx.tenantId),
        isNull(contacts.deletedAt),
        eq(contacts.doNotContact, false)
      ));

    // Per-contact completion tracking to prevent duplicate sends on crash/retry.
    // We store the set of already-sent contact IDs in cache keyed by batch identity.
    //
    // LIMITATION: This tracking relies on the cache layer (Redis or in-memory fallback).
    // When Redis is unavailable, the fallback is an in-memory Map which does NOT survive
    // process restarts. This means if the process crashes mid-batch while Redis is down,
    // a retry will re-send to all contacts (potential duplicates). For production
    // deployments requiring crash-safe deduplication, ensure Redis is available or
    // implement database-backed batch progress tracking (see FEAT-003 spec).
    const batchKey = makeBatchKey(ctx.tenantId, template_id, entity_ids);
    const alreadySent: Set<string> = new Set(
      (await cache.get<string[]>(batchKey)) || []
    );

    // Warn if Redis is not backing the cache - batch dedup is not durable
    if (!process.env['REDIS_URL']) {
      console.warn(
        '[email bulk] CRITICAL: Redis is not configured. Batch deduplication relies on ' +
        'in-memory cache which does not survive process restarts. Duplicate sends are ' +
        'possible if the process crashes mid-batch.'
      );
    }

    let sent = 0, failed = 0;
    const errors: string[] = [];
    const newlySentIds: string[] = [];

    try {
      for (const ent of ents) {
        // Skip contacts already processed in a previous attempt of this batch
        if (alreadySent.has(ent.id)) {
          sent++;
          continue;
        }

        if (!ent.email) { failed++; errors.push(`No email for ${ent.id}`); continue; }

        const vars: Record<string, string> = {
          first_name: ent.firstName || '',
          last_name: ent.lastName || '',
          email: ent.email,
        };

        const subject = renderTemplate(template.subject, vars);
        const html = renderTemplateHtml(template.bodyHtml, vars);

        const result = await sendEmail({ to: ent.email, subject, html });
        if (result.success) {
          sent++;
          newlySentIds.push(ent.id);
          // Persist progress after each successful send so a crash mid-loop
          // allows the next retry to skip already-sent contacts.
          // TTL of 24 hours to cover delayed retries (background jobs may retry after hours)
          await cache.set(batchKey, [...Array.from(alreadySent), ...newlySentIds], 86400);
        } else {
          failed++;
          errors.push(`${ent.email}: ${result.error}`);
        }
      }
    } catch (loopErr) {
      // Unexpected error mid-loop (e.g., server issue). We still return
      // partial results so the caller knows what was sent.
      // The batch key in cache ensures a retry will not re-send to contacts
      // that were already successfully sent in this invocation.
      console.error('[email bulk] Error during send loop:', loopErr);
      errors.push(`Batch interrupted: ${loopErr instanceof Error ? loopErr.message : 'Unknown error'}`);
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'bulk_email',
      entityType: entity_type,
      newData: { sent, failed, template_id },
    });

    return NextResponse.json({ ok: true, sent, failed, errors: errors.slice(0, 10) });
  } catch (err) {
    console.error('[email bulk]', err);
    return NextResponse.json({ error: 'Failed to send emails' }, { status: 500 });
  }
}
