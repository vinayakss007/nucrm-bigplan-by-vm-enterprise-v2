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
import { eq, and, sql, gt, isNull, desc, inArray, lt } from 'drizzle-orm';
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
    console.error('[DLQ] Retry from DLQ failed', e);
    return false;
  }
}

export async function listDLQEntries(tenantId: string, options: { limit: number; offset: number; status?: string }): Promise<{ entries: DLQEntry[]; total: number }> {
  const where = and(
    eq(deadLetterQueue.tenantId, tenantId),
    ...(options.status ? [eq(deadLetterQueue.status, options.status)] : []),
  );

  const entries = await db.query.deadLetterQueue.findMany({
    where,
    limit: options.limit,
    offset: options.offset,
    orderBy: desc(deadLetterQueue.createdAt),
  });

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(deadLetterQueue)
    .where(where)
    .then(rows => rows[0]?.count ?? 0);

  return { entries: entries as DLQEntry[], total };
}

export async function getDLQStats(tenantId: string): Promise<{ pending: number; resolved: number; total: number }> {
  const [pending, resolved, total] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(deadLetterQueue).where(and(eq(deadLetterQueue.tenantId, tenantId), eq(deadLetterQueue.status, 'pending'))).then(r => r[0]?.count ?? 0),
    db.select({ count: sql<number>`count(*)` }).from(deadLetterQueue).where(and(eq(deadLetterQueue.tenantId, tenantId), eq(deadLetterQueue.status, 'resolved'))).then(r => r[0]?.count ?? 0),
    db.select({ count: sql<number>`count(*)` }).from(deadLetterQueue).where(eq(deadLetterQueue.tenantId, tenantId)).then(r => r[0]?.count ?? 0),
  ]);
  return { pending, resolved, total };
}

export async function bulkRetryDLQ(ids: string[]): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await retryFromDLQ(id);
      succeeded++;
    } catch {
      failed++;
    }
  }
  return { succeeded, failed };
}

export async function purgeDLQEntry(id: string, tenantId: string): Promise<boolean> {
  const result = await db
    .delete(deadLetterQueue)
    .where(and(eq(deadLetterQueue.id, id), eq(deadLetterQueue.tenantId, tenantId)))
    .returning({ id: deadLetterQueue.id });
  return result.length > 0;
}

export async function purgeOldDLQEntries(daysOld: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  const result = await db
    .delete(deadLetterQueue)
    .where(lt(deadLetterQueue.createdAt, cutoff))
    .returning({ id: deadLetterQueue.id });
  return result.length;
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
