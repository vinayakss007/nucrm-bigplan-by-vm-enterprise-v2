/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, createHmac } from 'crypto';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';
import { and, eq, inArray } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { safeFetch, SsrfBlockedError } from '@/lib/security/ssrf';
import { getRetryDelay } from '@/lib/webhooks';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * POST /api/tenant/webhooks/retry
 * Retry one queued delivery by hand.
 *
 * Body: { delivery_id: string }   — a `webhook_queue` id, as listed by
 *                                   /api/tenant/webhooks/logs
 *
 * #2391: this handler used to read and write `webhook_deliveries`, a table with
 * no `url`, `headers`, `attempts`, `last_attempt_at`, `delivered_at` or
 * `error_message` column. Both statements failed with 42703 on the first call,
 * for every input, so the endpoint had never returned anything but a 500. It is
 * `webhook_queue` that carries a delivery's URL, headers and attempt count — the
 * table `fireWebhooks()` writes and `/logs` reads.
 *
 * It is now built with the query builder rather than `db.execute(sql`…`)` on
 * purpose: a column rename has to fail `npm run typecheck` instead of failing in
 * production on the first retry.
 */

/** Statuses a delivery can be retried from. `'error'` was never one of them —
 *  nothing in the codebase writes that value to `webhook_queue.status`. */
const RETRYABLE = ['failed', 'dead_letter'];

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'webhook-retry', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await readJsonBody(request);
    const deliveryId = (body as { delivery_id?: string } | null)?.delivery_id;
    if (!deliveryId) {
      return NextResponse.json({ error: 'delivery_id required' }, { status: 400 });
    }

    const [row] = await db
      .select({
        id: webhookQueue.id,
        webhookId: webhookQueue.webhookId,
        url: webhookQueue.url,
        method: webhookQueue.method,
        headers: webhookQueue.headers,
        payload: webhookQueue.payload,
        status: webhookQueue.status,
        attempt: webhookQueue.attempt,
      })
      .from(webhookQueue)
      .where(and(
        eq(webhookQueue.id, deliveryId),
        // Tenant-scoped here *and* on the write below. RLS would silently turn
        // another tenant's id into a 0-row UPDATE that still reported a retry.
        eq(webhookQueue.tenantId, ctx.tenantId),
        inArray(webhookQueue.status, RETRYABLE)
      ))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: 'No retryable delivery with that id. It may belong to another tenant, already be delivered, or have been purged by retention.' },
        { status: 404 }
      );
    }

    // The parent decides whether a send is allowed at all. Retrying into a URL
    // the tenant deleted would undo #2390, and a disabled webhook is the
    // tenant's own pause switch — an automatic sweep must not override either,
    // and neither must a button.
    const [parent] = await db
      .select({ id: integrations.id, isActive: integrations.isActive, deletedAt: integrations.deletedAt, config: integrations.config })
      .from(integrations)
      .where(and(eq(integrations.id, row.webhookId), eq(integrations.tenantId, ctx.tenantId)))
      .limit(1);

    if (!parent || parent.deletedAt) {
      return NextResponse.json({ error: 'The webhook this delivery belonged to has been deleted, so it cannot be sent.' }, { status: 410 });
    }
    if (!parent.isActive) {
      return NextResponse.json({ error: 'The webhook is disabled. Enable it before retrying.' }, { status: 409 });
    }

    // The stored payload went through jsonb, so re-serialising is not guaranteed
    // to reproduce the original bytes. Sign what is about to go on the wire
    // rather than replaying a signature that may no longer match — and honour a
    // secret that was rotated since the failed attempt.
    const payloadStr = JSON.stringify(row.payload ?? {});
    const secret = typeof (parent.config as Record<string, unknown> | null)?.['secret'] === 'string'
      ? (parent.config as Record<string, unknown>)['secret'] as string
      : undefined;
    const stored = (row.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'NuCRM-Webhook/1.0',
      ...stored,
      // The stored delivery id was the original attempt's; a receiver deduping
      // on it would discard this retry as already seen.
      'X-NuCRM-Delivery': randomUUID(),
    };
    if (secret) headers['X-NuCRM-Signature'] = 'sha256=' + createHmac('sha256', secret).update(payloadStr).digest('hex');
    else delete headers['X-NuCRM-Signature'];

    const nextAttempt = row.attempt + 1;
    const writeWhere = and(eq(webhookQueue.id, row.id), eq(webhookQueue.tenantId, ctx.tenantId));

    const finish = async (set: Record<string, unknown>): Promise<boolean> => {
      const updated = await db.update(webhookQueue).set({ ...set, updatedAt: new Date() }).where(writeWhere).returning({ id: webhookQueue.id });
      return updated.length > 0;
    };

    // One place decides what a failed attempt costs the row. A row that was
    // already dead-lettered has spent its automatic retries — this manual
    // attempt is its one extra shot, so a failure puts it straight back rather
    // than reopening the sweep.
    const failureState = () => {
      const delay = row.status === 'dead_letter' ? -1 : getRetryDelay(nextAttempt);
      return {
        status: delay < 0 ? 'dead_letter' : 'failed',
        nextRetryAt: delay < 0 ? null : new Date(Date.now() + delay),
      };
    };

    let res: Response;
    try {
      res = await safeFetch(row.url, {
        method: row.method || 'POST',
        headers,
        body: payloadStr,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        // Never retryable: the target stays blocked however often we knock.
        await finish({ status: 'dead_letter', errorMessage: `Blocked by SSRF protection: ${err.reason}`, nextRetryAt: null, attempt: nextAttempt });
        return NextResponse.json({ error: `Blocked by SSRF protection: ${err.reason}`, data: { delivery_id: deliveryId, status: 'dead_letter' } }, { status: 502 });
      }
      const state = failureState();
      const message = err instanceof Error ? err.message : String(err);
      const saved = await finish({ ...state, errorMessage: message, responseStatus: null, deliveredAt: null, failedAt: new Date(), attempt: nextAttempt });
      if (!saved) return NextResponse.json({ error: 'Delivery no longer exists.' }, { status: 404 });
      // A transport failure is still an answer about the delivery: report the
      // retry as failed (200) rather than as a broken endpoint.
      return NextResponse.json({
        data: { delivery_id: deliveryId, status: state.status, error: message, retried_at: new Date().toISOString() },
      });
    }

    const responseStatus = res.status;
    if (res.ok) {
      const saved = await finish({ status: 'delivered', responseStatus, deliveredAt: new Date(), errorMessage: null, responseBody: null, nextRetryAt: null, attempt: nextAttempt });
      if (!saved) return NextResponse.json({ error: 'Delivery no longer exists.' }, { status: 404 });
      return NextResponse.json({ data: { delivery_id: deliveryId, status: 'delivered', response_status: responseStatus, retried_at: new Date().toISOString() } });
    }

    const responseBody = await res.text().catch(() => '');
    const state = failureState();
    const saved = await finish({
      ...state,
      responseStatus,
      responseBody: responseBody.slice(0, 1000),
      errorMessage: `Remote returned ${responseStatus}`,
      deliveredAt: null,
      failedAt: new Date(),
      attempt: nextAttempt,
    });
    if (!saved) return NextResponse.json({ error: 'Delivery no longer exists.' }, { status: 404 });
    return NextResponse.json({
      data: { delivery_id: deliveryId, status: state.status, response_status: responseStatus, retried_at: new Date().toISOString() },
    });
  } catch (err) {
    void logError({ error: err, context: 'tenant/webhooks/retry' });
    return apiError(err);
  }
});
