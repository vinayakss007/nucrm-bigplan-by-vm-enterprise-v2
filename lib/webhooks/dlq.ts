/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Webhook Dead Letter Queue (DLQ)
 *
 * When a webhook exhausts all retries, its payload is moved to the DLQ
 * for manual inspection, retry, or purge.
 *
 * Uses the existing dead_letter_queue table in the schema.
 *
 * Features:
 * - Automatic DLQ insertion after max retries
 * - Manual retry from DLQ (creates new delivery attempt)
 * - Bulk purge of old DLQ entries
 * - DLQ statistics and monitoring
 */

import { deadLetterQueue, webhookDeliveries } from '@/drizzle/schema/automation';
import { eq, and, sql, desc, lt } from 'drizzle-orm';
import { devLogger } from '@/lib/dev-logger';
import { logger } from '@/lib/logger';
import { withTenantContext, withSecurityContext, NO_USER_SENTINEL, type RlsTransaction } from '@/lib/db/rls';

export interface DLQEntry {
  id: string;
  tenantId: string;
  jobType: string;
  jobId: string | null;
  queue: string;
  payload: unknown;
  errorMessage: string;
  errorStack: string | null;
  attempts: number;
  maxAttempts: number;
  status: string;
  failedAt: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  createdAt: Date;
}

/**
 * Move a failed webhook delivery to the dead letter queue.
 * Called when all retries are exhausted.
 *
 * #3312: both tables are FORCE-RLS. `dead_letter_queue` has the 0093
 * super-admin arm, but `webhook_deliveries` has only `tenant_isolation`, so a
 * read on the bare pool answers zero rows and the failed delivery is silently
 * never moved. `tenantId` is required: the caller already holds the delivery
 * row and its tenant, and there is no context that can read another tenant's
 * delivery by id.
 */
export async function moveToDeadLetterQueue(deliveryId: string, tenantId: string): Promise<string | null> {
  return withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
    const delivery = await tx.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.id, deliveryId),
    });

    if (!delivery) {
      devLogger.error(new Error('Delivery not found'), `DLQ: delivery ${deliveryId}`);
      return null;
    }

    if (delivery.status !== 'failed') {
      return null; // Only failed deliveries go to DLQ
    }

    const metadata = (delivery.metadata as Record<string, unknown>) || {};
    const asNum = (v: unknown, fallback: number): number =>
      (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const url = typeof metadata.url === 'string' ? metadata.url : '';

    // Insert into the dead_letter_queue table
    const [dlqEntry] = await tx.insert(deadLetterQueue)
      .values({
        tenantId: delivery.tenantId,
        jobType: 'webhook',
        jobId: delivery.webhookId,
        queue: 'webhook-deliveries',
        payload: {
          deliveryId,
          eventType: delivery.eventType,
          url,
          payload: delivery.payload,
          headers: metadata.headers,
        },
        errorMessage: typeof metadata.failureReason === 'string' ? metadata.failureReason
          : (typeof metadata.lastError === 'string' ? metadata.lastError : 'Unknown error'),
        errorStack: typeof metadata.errorStack === 'string' ? metadata.errorStack : null,
        attempts: asNum(metadata.attempt, 0),
        maxAttempts: asNum(metadata.maxRetries, 3),
        status: 'pending',
        originalRunAt: delivery.createdAt,
        failedAt: new Date(),
      })
      .returning({ id: deadLetterQueue.id });

    devLogger.queue('dlq', `Webhook ${deliveryId} moved to dead letter queue as ${dlqEntry?.id}`);

    return dlqEntry?.id || null;
  });
}

/**
 * Retry a dead letter queue entry.
 * Creates a new webhook delivery attempt with reset counter.
 *
 * When `tenantId` is provided, the entry is only retried if it belongs to
 * that tenant — prevents one tenant from retrying another's dead letters.
 */
export async function retryFromDLQ(dlqEntryId: string, tenantId?: string): Promise<boolean> {
  // #3312: the lookup and the reset are RLS-bound. A tenant caller reads its
  // own entry under `app.current_tenant`; the system caller (cron/bulk sweep)
  // reads under the 0093 super-admin arm. The reset itself always runs under
  // the ENTRY's tenant — `webhook_deliveries` has no super-admin arm, so a
  // system context would update zero rows and report a retry that never
  // happened.
  const entry = tenantId
    ? await withTenantContext(tenantId, NO_USER_SENTINEL, (tx) =>
        tx.query.deadLetterQueue.findFirst({
          where: and(eq(deadLetterQueue.id, dlqEntryId), eq(deadLetterQueue.tenantId, tenantId)),
        }))
    : await withSecurityContext((tx) =>
        tx.query.deadLetterQueue.findFirst({
          where: eq(deadLetterQueue.id, dlqEntryId),
        }));

  if (!entry) {
    return false;
  }

  if (entry.status !== 'pending') {
    throw new Error(`DLQ entry ${dlqEntryId} is not retryable (status: ${entry.status})`);
  }

  const payload = entry.payload as { deliveryId?: string; url?: string; headers?: Record<string, unknown> };
  if (!payload || !payload.deliveryId) {
    throw new Error('Invalid DLQ payload — missing deliveryId');
  }

  // Reset the original delivery + mark DLQ entry resolved atomically
  await withTenantContext(entry.tenantId, NO_USER_SENTINEL, async (tx) => {
    await tx.update(webhookDeliveries)
      .set({
        status: 'pending',
        responseStatus: null,
        responseBody: null,
        durationMs: null,
        metadata: {
          ...(payload.headers || {}),
          attempt: 0,
          max_retries: entry.maxAttempts,
          url: payload.url,
          dlqRetriedAt: new Date().toISOString(),
          dlqEntryId,
        },
      })
      .where(eq(webhookDeliveries.id, payload.deliveryId!));

    await tx.update(deadLetterQueue)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolution: 'retried',
      })
      .where(eq(deadLetterQueue.id, dlqEntryId));
  });

  devLogger.queue('dlq', `Retrying DLQ entry ${dlqEntryId} → delivery ${payload.deliveryId}`);

  // Trigger immediate delivery
  const { processWebhookDelivery } = await import('./delivery');
  try {
    await processWebhookDelivery(payload.deliveryId, entry.tenantId, payload.url);
    return true;
  } catch (e) {
    logger.error('[DLQ] Retry delivery failed', { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export async function listDLQEntries(tenantId: string, options: { limit: number; offset: number; status?: string }): Promise<{ entries: DLQEntry[]; total: number }> {
  const where = and(
    eq(deadLetterQueue.tenantId, tenantId),
    ...(options.status ? [eq(deadLetterQueue.status, options.status)] : []),
  );

  // #3312: one tenant context for both statements, so the page and its total
  // describe the same visible set.
  return withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
    const entries = await tx.query.deadLetterQueue.findMany({
      where,
      limit: options.limit,
      offset: options.offset,
      orderBy: desc(deadLetterQueue.createdAt),
    });

    const total = await tx
      .select({ count: sql<number>`count(*)` })
      .from(deadLetterQueue)
      .where(where)
      .then(rows => rows[0]?.count ?? 0);

    return { entries: entries as DLQEntry[], total };
  });
}

export async function getDLQStats(tenantId: string): Promise<{ pending: number; resolved: number; total: number }> {
  // #3312: the counts are RLS-filtered; on the bare pool they are all zero.
  return withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
    const pending = await tx.select({ count: sql<number>`count(*)` }).from(deadLetterQueue).where(and(eq(deadLetterQueue.tenantId, tenantId), eq(deadLetterQueue.status, 'pending'))).then(r => r[0]?.count ?? 0);
    const resolved = await tx.select({ count: sql<number>`count(*)` }).from(deadLetterQueue).where(and(eq(deadLetterQueue.tenantId, tenantId), eq(deadLetterQueue.status, 'resolved'))).then(r => r[0]?.count ?? 0);
    const total = await tx.select({ count: sql<number>`count(*)` }).from(deadLetterQueue).where(eq(deadLetterQueue.tenantId, tenantId)).then(r => r[0]?.count ?? 0);
    return { pending, resolved, total };
  });
}

export async function bulkRetryDLQ(ids: string[], tenantId?: string): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const result = await retryFromDLQ(id, tenantId);
      if (result) succeeded++;
      else failed++;
    } catch (e) {
      logger.error('[DLQ] Bulk retry failed for entry', { entryId: id, tenantId, error: e instanceof Error ? e.message : String(e) });
      failed++;
    }
  }
  return { succeeded, failed };
}

export async function purgeDLQEntry(id: string, tenantId: string): Promise<boolean> {
  return withTenantContext(tenantId, NO_USER_SENTINEL, async (tx) => {
    const result = await tx
      .delete(deadLetterQueue)
      .where(and(eq(deadLetterQueue.id, id), eq(deadLetterQueue.tenantId, tenantId)))
      .returning({ id: deadLetterQueue.id });
    return result.length > 0;
  });
}

/**
 * Purge DLQ entries older than `daysOld`. When `tenantId` is provided the
 * delete is scoped to that tenant; system callers (cron) may omit it.
 *
 * #3312: the tenant path runs under `app.current_tenant`; the system path runs
 * under the 0093 super-admin arm, which `dead_letter_queue` carries explicitly
 * for the retry-webhooks cron. Neither path may run on the bare pool: the
 * tenant policy would delete zero rows and the cron would report a successful
 * purge that removed nothing.
 */
export async function purgeOldDLQEntries(daysOld: number, tenantId?: string): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  const run = async (tx: RlsTransaction) => {
    const result = await tx
      .delete(deadLetterQueue)
      .where(tenantId
        ? and(lt(deadLetterQueue.createdAt, cutoff), eq(deadLetterQueue.tenantId, tenantId))
        : lt(deadLetterQueue.createdAt, cutoff))
      .returning({ id: deadLetterQueue.id });
    return result.length;
  };
  return tenantId
    ? withTenantContext(tenantId, NO_USER_SENTINEL, run)
    : withSecurityContext(run);
}
export default {
  moveToDeadLetterQueue,
  retryFromDLQ,
  bulkRetryDLQ,
  purgeOldDLQEntries,
  getDLQStats,
  listDLQEntries,
  purgeDLQEntry,
};
