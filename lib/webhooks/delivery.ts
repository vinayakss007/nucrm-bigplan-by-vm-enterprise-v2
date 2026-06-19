/**
 * Webhook Delivery with Retry Mechanism
 * 
 * Features:
 * - Retry with exponential backoff
 * - Delivery logging
 * - Failure tracking
 */

import { db } from '@/drizzle/db';
import { webhookDeliveries } from '@/drizzle/schema/automation';
import { eq, and, sql, gt } from 'drizzle-orm';
import { devLogger } from '@/lib/dev-logger';

export interface WebhookPayload {
  id: string;
  tenant_id: string;
  url: string;
  event: string;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  headers?: Record<string, string>;
  max_retries?: number;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  url: string;
  event_type: string;
  status: 'pending' | 'delivered' | 'failed';
  response_status?: number;
  response_body?: string;
  duration_ms?: number;
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  max_retries?: number;
}

/**
 * Queue webhook for delivery with retry
 */
export async function queueWebhook(payload: WebhookPayload): Promise<string> {
  const [result] = await db.insert(webhookDeliveries)
    .values({
      tenantId: payload.tenant_id,
      webhookId: payload.id,
      eventType: payload.event,
      payload: payload.payload,
      status: 'pending',
    })
    .returning({ id: webhookDeliveries.id });

  if (!result) {
    throw new Error('Failed to queue webhook');
  }

  // Immediately attempt delivery
  try {
    await processWebhookDelivery(result.id, payload.url, payload.headers);
  } catch {
    // Will be retried
  }

  devLogger.queue('webhook-delivery', 'queued');

  return result.id;
}

/**
 * Process webhook delivery
 */
export async function processWebhookDelivery(deliveryId: string, url?: string, headers?: Record<string, string>): Promise<void> {
  const delivery = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, deliveryId)
  });

  if (!delivery) {
    throw new Error(`Webhook delivery ${deliveryId} not found`);
  }

  const deliveryUrl = url || (delivery.metadata as { url?: string })?.url;
  if (!deliveryUrl) {
    throw new Error(`No URL found for webhook delivery ${deliveryId}`);
  }

  const payloadData = delivery.payload;
  const attempt = ((delivery.metadata as { attempt?: number })?.attempt || 0) + 1;
  const maxRetries = (delivery.metadata as { max_retries?: number })?.max_retries || 3;

  const sigHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'NuCRM-Webhook/1.0',
    'X-Webhook-Signature': await generateSignature({
      id: delivery.id,
      webhook_id: delivery.webhookId || '',
      url: deliveryUrl,
      event_type: delivery.eventType,
      status: 'pending',
      payload: payloadData,
      max_retries: maxRetries,
    } as unknown as WebhookDelivery),
    ...(headers || {}),
  };

  const startTime = Date.now();

  try {
    const response = await fetch(deliveryUrl, {
      method: 'POST',
      headers: sigHeaders,
      body: JSON.stringify(payloadData),
      signal: AbortSignal.timeout(10_000),
    });

    const responseBody = await response.text();
    const durationMs = Date.now() - startTime;

    if (response.ok) {
      await db.update(webhookDeliveries)
        .set({
          status: 'success',
          responseStatus: response.status,
          responseBody: responseBody,
          durationMs: durationMs,
        })
        .where(eq(webhookDeliveries.id, deliveryId));

      devLogger.queue('webhook-delivery', 'completed');
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    if (attempt < maxRetries) {
      // Exponential backoff with jitter to prevent thundering herd
      const baseDelay = Math.pow(2, attempt) * 60;
      const jitter = Math.random() * baseDelay * 0.3; // ±30% jitter
      const delay = baseDelay + jitter;
      const nextRetry = new Date(Date.now() + delay * 1000);

      await db.update(webhookDeliveries)
        .set({
          status: 'pending',
          responseBody: error.message,
          durationMs: durationMs,
          metadata: {
            ...(delivery.metadata as Record<string, unknown>),
            attempt,
            max_retries: maxRetries,
            url: deliveryUrl,
            nextRetryAt: nextRetry.toISOString(),
            lastError: error.message,
          }
        })
        .where(eq(webhookDeliveries.id, deliveryId));

      devLogger.queue('webhook-delivery', `retrying (attempt ${attempt}/${maxRetries}, delay ${Math.round(delay)}s)`);
    } else {
      // Max retries exhausted — move to dead letter queue
      await db.update(webhookDeliveries)
        .set({
          status: 'failed',
          responseBody: error.message,
          durationMs: durationMs,
          metadata: {
            ...(delivery.metadata as Record<string, unknown>),
            attempt,
            max_retries: maxRetries,
            url: deliveryUrl,
            failureReason: error.message,
            exhaustedAt: new Date().toISOString(),
          }
        })
        .where(eq(webhookDeliveries.id, deliveryId));

      // Move to DLQ for manual inspection
      const { moveToDeadLetterQueue } = await import('./dlq');
      await moveToDeadLetterQueue(deliveryId);

      devLogger.queue('webhook-delivery', 'failed — moved to dead letter queue');
      devLogger.error(error as Error, `Webhook delivery ${deliveryId} exhausted ${maxRetries} retries`);
    }
  }
}

/**
 * Generate webhook signature for verification
 */
export async function generateSignature(delivery: WebhookDelivery): Promise<string> {
  const { createHmac } = await import('crypto');
  const secret = process.env['WEBHOOK_SECRET'];
  
  if (!secret || secret === 'webhook-secret-change-in-production') {
    throw new Error('WEBHOOK_SECRET environment variable must be configured in production');
  }

  const payload = JSON.stringify(delivery.payload);
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return `sha256=${signature}`;
}

/**
 * Get webhook delivery stats
 */
export async function getWebhookStats(webhookId: string, days: number = 7): Promise<{
  total: number;
  success: number;
  failed: number;
  pending: number;
  avgDeliveryTime: number;
}> {
  const daysInterval = sql`interval '${sql.raw(days.toString())} days'`;

  const totalResults = await db.select({ count: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.webhookId, webhookId), gt(webhookDeliveries.createdAt, sql`now() - ${daysInterval}`)));

  const successResults = await db.select({ count: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.webhookId, webhookId), 
      eq(webhookDeliveries.status, 'delivered'), 
      gt(webhookDeliveries.createdAt, sql`now() - ${daysInterval}`))
    );

  const failedResults = await db.select({ count: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.webhookId, webhookId), 
      eq(webhookDeliveries.status, 'failed'), 
      gt(webhookDeliveries.createdAt, sql`now() - ${daysInterval}`))
    );

  const pendingResults = await db.select({ count: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.webhookId, webhookId), 
      eq(webhookDeliveries.status, 'pending'), 
      gt(webhookDeliveries.createdAt, sql`now() - ${daysInterval}`))
    );

  const avgTimeResults = await db.select({ avg_ms: sql<number>`EXTRACT(EPOCH FROM AVG(delivered_at - created_at)) * 1000` })
    .from(webhookDeliveries)
    .where(and(
      eq(webhookDeliveries.webhookId, webhookId), 
      eq(webhookDeliveries.status, 'delivered'), 
      gt(webhookDeliveries.createdAt, sql`now() - ${daysInterval}`))
    );

  return {
    total: totalResults[0]?.count || 0,
    success: successResults[0]?.count || 0,
    failed: failedResults[0]?.count || 0,
    pending: pendingResults[0]?.count || 0,
    avgDeliveryTime: avgTimeResults[0]?.avg_ms || 0,
  };
}

export default {
  queueWebhook,
  processWebhookDelivery,
  generateSignature,
  getWebhookStats,
};
