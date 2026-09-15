/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Provider-webhook idempotency ledger (#1908).
 *
 * Stripe/Razorpay/PayU all deliver at-least-once, and the Redis lock
 * (`acquireLock`) fails OPEN when Redis is down — so every replay would
 * re-run money-affecting handlers. This module is the DB-level source of
 * truth: claiming is a single INSERT against the UNIQUE(provider, event_id)
 * key, so exactly one concurrent delivery wins no matter what Redis does.
 *
 * Usage per handler:
 *   1. (optional fast path) Redis acquireLock — drops hot replays cheaply.
 *   2. `claimWebhookEvent(...)` — false means already processed → 200+duplicate.
 *   3. Run side effects.
 *   4a. Success → `completeWebhookEvent(...)` (audit row kept).
 *   4b. Failure → `releaseWebhookEvent(...)` (claim row deleted) so the
 *       provider's retry re-processes instead of being dropped as a dup.
 */
import { db } from '@/drizzle/db';
import { withSecurityContext } from '@/lib/db/rls';
import { webhookEvents } from '@/drizzle/schema';
import { eq, and, lt } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/** Age after which a 'claimed' row is assumed orphaned (worker crashed). */
const STALE_CLAIM_MS = 30 * 60 * 1000;

export type WebhookProvider = 'stripe' | 'razorpay' | 'payu';

/**
 * Attempt to claim a provider delivery. Returns true when this caller won
 * the claim and must process the event; false when it was already claimed
 * (duplicate delivery — skip side effects).
 */
export async function claimWebhookEvent(opts: {
  provider: WebhookProvider;
  eventId: string;
  eventType?: string;
  tenantId?: string | null;
}): Promise<boolean> {
  // 0088 put RLS on webhook_events. A delivery claim is made before the tenant
  // is resolved (tenant_id is NULL on the row) and must then be readable and
  // stealable by the worker, so the whole claim is one security-context
  // transaction. An ordinary tenant context sees none of it.
  return await withSecurityContext(async (tx) => {
  const [row] = await tx
    .insert(webhookEvents)
    .values({
      provider: opts.provider,
      eventId: opts.eventId,
      eventType: opts.eventType ?? null,
      tenantId: opts.tenantId ?? null,
      status: 'claimed',
    })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
    .returning({ id: webhookEvents.id });
  if (row) return true;

  // Conflict path: normally a genuine duplicate. Exception — a 'claimed' row
  // older than STALE_CLAIM_MS means the worker died mid-processing (crash,
  // deploy, OOM) without releasing. Steal it so the retry still processes;
  // the UPDATE's WHERE makes the steal atomic under concurrency.
  const [stolen] = await tx
    .update(webhookEvents)
    .set({ createdAt: new Date() })
    .where(and(
      eq(webhookEvents.provider, opts.provider),
      eq(webhookEvents.eventId, opts.eventId),
      eq(webhookEvents.status, 'claimed'),
      lt(webhookEvents.createdAt, new Date(Date.now() - STALE_CLAIM_MS)),
    ))
    .returning({ id: webhookEvents.id });
  return !!stolen;
  });
}

/** Mark a claimed event processed (audit trail; row is kept). */
export async function completeWebhookEvent(provider: WebhookProvider, eventId: string): Promise<void> {
  await withSecurityContext(async (tx) => tx
    .update(webhookEvents)
    .set({ status: 'processed', processedAt: new Date() })
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId))));
}

/**
 * Delete a claim so a failed delivery can be retried and re-processed.
 * Called on handler failure, mirroring the Redis-lock release.
 */
export async function releaseWebhookEvent(provider: WebhookProvider, eventId: string): Promise<void> {
  try {
    await withSecurityContext(async (tx) => tx
      .delete(webhookEvents)
      .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId))));
  } catch (err) {
    // Best-effort: the retry will simply be treated as a duplicate and can
    // be recovered from Stripe/Razorpay dashboards. Never mask the real error.
    logger.error('[webhook-idempotency] failed to release claim', { provider, eventId, err });
  }
}
