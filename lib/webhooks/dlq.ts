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
import { eq, and, sql, gt, isNull, desc, inArray } from 'drizzle-orm';
import { devLogger } from '@/lib/dev-logger';

export interface DLQEntry {
  id: string;
  tenantId: string;
  jobType: string;
  jobId: string | null;
  queue: string;
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

  const metadata = (delivery.metadata as any) || {};
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
    })
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

  const payload = entry.payload as any;
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
    console.error('[DLQ] Retry delivery failed:', e);
    return false;
  }
}

/**
 * Bulk retry multiple DLQ entries.
 */
export async function bulkRetryDLQ(dlqEntryIds: string[]): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const id of dlqEntryIds) {
    try {
      const result = await retryFromDLQ(id);
      if (result) succeeded++;
      else failed++;
    } catch (e) {
      console.error('[DLQ] Bulk retry failed for entry:', id, e);
      failed++;
    }
  }

  return { succeeded, failed };
}

/**
 * Purge old DLQ entries older than the specified days.
 */
export async function purgeOldDLQEntries(daysOld: number = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);

  const result = await db.delete(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.jobType, 'webhook'),
      gt(sql`${cutoff.toISOString()}`, deadLetterQueue.failedAt),
    ));

  const count = result.rowCount || 0;
  devLogger.queue('dlq', `Purged ${count} webhook entries older than ${daysOld} days`);
  return count;
}

/**
 * Get DLQ statistics for a tenant.
 */
export async function getDLQStats(tenantId: string): Promise<{
  total: number;
  byEventType: Array<{ eventType: string; count: number }>;
  oldestEntry: Date | null;
  resolved: number;
  pending: number;
}> {
  const totalResult = await db.select({ count: sql<number>`count(*)::int` })
    .from(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.tenantId, tenantId),
      eq(deadLetterQueue.jobType, 'webhook'),
    ));

  const pendingResult = await db.select({ count: sql<number>`count(*)::int` })
    .from(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.tenantId, tenantId),
      eq(deadLetterQueue.jobType, 'webhook'),
      eq(deadLetterQueue.status, 'pending'),
    ));

  const resolvedResult = await db.select({ count: sql<number>`count(*)::int` })
    .from(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.tenantId, tenantId),
      eq(deadLetterQueue.jobType, 'webhook'),
      eq(deadLetterQueue.status, 'resolved'),
    ));

  const oldestResult = await db.select({ failedAt: deadLetterQueue.failedAt })
    .from(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.tenantId, tenantId),
      eq(deadLetterQueue.jobType, 'webhook'),
    ))
    .orderBy(deadLetterQueue.failedAt)
    .limit(1);

  return {
    total: totalResult[0]?.count || 0,
    pending: pendingResult[0]?.count || 0,
    resolved: resolvedResult[0]?.count || 0,
    oldestEntry: oldestResult[0]?.failedAt || null,
    byEventType: [],
  };
}

/**
 * List DLQ entries for a tenant with pagination.
 */
export async function listDLQEntries(
  tenantId: string,
  options: { limit?: number; offset?: number; status?: string } = {}
): Promise<{ entries: any[]; total: number }> {
  const { limit = 50, offset = 0, status } = options;

  const filters: any[] = [
    eq(deadLetterQueue.tenantId, tenantId),
    eq(deadLetterQueue.jobType, 'webhook'),
  ];

  if (status) {
    filters.push(eq(deadLetterQueue.status, status));
  }

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
    .from(deadLetterQueue)
    .where(and(...filters));

  const entries = await db.select({
    id: deadLetterQueue.id,
    jobType: deadLetterQueue.jobType,
    jobId: deadLetterQueue.jobId,
    queue: deadLetterQueue.queue,
    payload: deadLetterQueue.payload,
    errorMessage: deadLetterQueue.errorMessage,
    errorStack: deadLetterQueue.errorStack,
    attempts: deadLetterQueue.attempts,
    maxAttempts: deadLetterQueue.maxAttempts,
    status: deadLetterQueue.status,
    failedAt: deadLetterQueue.failedAt,
    resolvedAt: deadLetterQueue.resolvedAt,
    resolution: deadLetterQueue.resolution,
    createdAt: deadLetterQueue.createdAt,
  })
    .from(deadLetterQueue)
    .where(and(...filters))
    .orderBy(desc(deadLetterQueue.failedAt))
    .limit(limit)
    .offset(offset);

  return {
    entries,
    total: countResult?.count || 0,
  };
}

/**
 * Permanently delete a DLQ entry.
 */
export async function purgeDLQEntry(dlqEntryId: string, tenantId: string): Promise<boolean> {
  const result = await db.delete(deadLetterQueue)
    .where(and(
      eq(deadLetterQueue.id, dlqEntryId),
      eq(deadLetterQueue.tenantId, tenantId),
      eq(deadLetterQueue.jobType, 'webhook'),
    ));

  return (result.rowCount || 0) > 0;
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
