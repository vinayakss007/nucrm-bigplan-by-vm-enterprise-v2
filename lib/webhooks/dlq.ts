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

import { db } from '@/drizzle/db';
import { deadLetterQueue, webhookDeliveries } from '@/drizzle/schema/automation';
import { eq, and, sql } from 'drizzle-orm';
import { devLogger } from '@/lib/dev-logger';

export interface DLQEntry {
  id: string;
  tenantId: string;
  jobType: string;
  jobId: string | null;
  queue: string;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
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
 */
export async function moveToDeadLetterQueue(deliveryId: string): Promise<string | null> {
  const delivery = await db.query.webhookDeliveries.findFirst({
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
  const url = metadata.url || '';

  // Insert into the dead_letter_queue table
  const [dlqEntry] = await db.insert(deadLetterQueue)
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
      errorMessage: metadata.failureReason || metadata.lastError || 'Unknown error',
      errorStack: metadata.errorStack || null,
      attempts: metadata.attempt || 0,
      maxAttempts: metadata.maxRetries || 3,
      status: 'pending',
      originalRunAt: delivery.createdAt,
      failedAt: new Date(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .returning({ id: deadLetterQueue.id });

  devLogger.queue('dlq', `Webhook ${deliveryId} moved to dead letter queue as ${dlqEntry?.id}`);

  return dlqEntry?.id || null;
}

/**
 * Retry a dead letter queue entry.
 * Creates a new webhook delivery attempt with reset counter.
 */
export async function retryFromDLQ(dlqEntryId: string): Promise<boolean> {
  const entry = await db.query.deadLetterQueue.findFirst({
    where: eq(deadLetterQueue.id, dlqEntryId),
  });

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

  // Reset the original delivery for retry
  await db.update(webhookDeliveries)
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
    .where(eq(webhookDeliveries.id, payload.deliveryId));

  // Mark DLQ entry as resolved
  await db.update(deadLetterQueue)
    .set({
      status: 'resolved',
      resolvedAt: new Date(),
      resolution: 'retried',
    })
    .where(eq(deadLetterQueue.id, dlqEntryId));

  devLogger.queue('dlq', `Retrying DLQ entry ${dlqEntryId} → delivery ${payload.deliveryId}`);

  // Trigger immediate delivery
  const { processWebhookDelivery } = await import('./delivery');
  try {
    await processWebhookDelivery(payload.deliveryId, payload.url);
    return true;
  } catch (e) {
    console.error('[DLQ] Retry from DLQ failed', e);
    return false;
  }
}

export async function listDLQEntries(
  tenantId: string,
  opts: { limit: number; offset: number; status?: string }
): Promise<{ entries: unknown[]; total: number }> {
  const conditions = [eq(deadLetterQueue.tenantId, tenantId)];
  if (opts.status) {
    conditions.push(eq(deadLetterQueue.status, opts.status));
  }
  const entries = await db.query.deadLetterQueue.findMany({
    where: and(...conditions),
    limit: opts.limit,
    offset: opts.offset,
    orderBy: (dlq, { desc }) => [desc(dlq.createdAt)],
  });
  const totalResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(deadLetterQueue)
    .where(and(...conditions));
  return { entries, total: totalResult[0]?.count ?? 0 };
}

export async function getDLQStats(tenantId: string) {
  const rows = await db
    .select({
      status: deadLetterQueue.status,
      count: sql<number>`count(*)::int`,
    })
    .from(deadLetterQueue)
    .where(eq(deadLetterQueue.tenantId, tenantId))
    .groupBy(deadLetterQueue.status);
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const pending = rows.find(r => r.status === 'pending')?.count ?? 0;
  const resolved = rows.find(r => r.status === 'resolved')?.count ?? 0;
  const failed = rows.find(r => r.status === 'failed')?.count ?? 0;
  return { total, pending, resolved, failed };
}

export async function bulkRetryDLQ(ids: string[]): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const ok = await retryFromDLQ(id);
      if (ok) succeeded++; else failed++;
    } catch {
      failed++;
    }
  }
  return { succeeded, failed };
}

export async function purgeDLQEntry(id: string, tenantId: string): Promise<boolean> {
  const result = await db
    .delete(deadLetterQueue)
    .where(and(eq(deadLetterQueue.id, id), eq(deadLetterQueue.tenantId, tenantId)));
  return (result.rowCount ?? 0) > 0;
}

export async function purgeOldDLQEntries(daysOld: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  const result = await db
    .delete(deadLetterQueue)
    .where(sql`${deadLetterQueue.createdAt} < ${cutoff}`);
  return result.rowCount ?? 0;
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
