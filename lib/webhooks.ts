import { createHmac, randomUUID } from 'crypto';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';
import { eq, and, lte, lt, sql, asc } from 'drizzle-orm';
import { logger } from '@/lib/logger';

/**
 * Get retry delay using exponential backoff.
 * attempt 1 = 5 min, attempt 2 = 30 min, attempt 3 = 2 hr, attempt 4 = 12 hr, attempt 5 = dead letter
 */
export function getRetryDelay(attempt: number): number {
  const delays = [
    5 * 60 * 1000,       // 5 minutes
    30 * 60 * 1000,      // 30 minutes
    2 * 60 * 60 * 1000,  // 2 hours
    12 * 60 * 60 * 1000, // 12 hours
  ];

  if (attempt <= 0) return delays[0]!;
  if (attempt > delays.length) return -1; // Dead letter
  return delays[attempt - 1]!;
}

const MAX_RETRIES = 5;

export type WebhookEvent =
  | 'contact.created' | 'contact.updated' | 'contact.deleted' | 'contact.restored'
  | 'deal.created'    | 'deal.updated'    | 'deal.stage_changed' | 'deal.won' | 'deal.lost' | 'deal.deleted'
  | 'task.created'    | 'task.completed'   | 'task.deleted'
  | 'company.created' | 'company.updated'  | 'company.deleted'
  | 'lead.created'    | 'lead.updated'     | 'lead.deleted' | 'lead.converted'
  | 'ticket.created'  | 'ticket.resolved'
  | 'invoice.created' | 'invoice.paid'
  | 'form.submitted'
  | 'automation.triggered'
  | 'module.installed' | 'module.disabled';

export async function fireWebhooks(
  tenantId: string,
  event: WebhookEvent,
  data: Record<string, any>
) {
  try {
    const hooks = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.tenantId, tenantId),
        eq(integrations.type, 'webhook'),
        eq(integrations.isActive, true)
      ));
      
    if (!hooks.length) return;

    const payloadObj = {
      event,
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      data,
    };
    const payload = JSON.stringify(payloadObj);

    for (const hook of hooks) {
      const config = hook.config as { url?: string; events?: string[]; secret?: string; headers?: Record<string, string> };
      const url = config?.url;
      if (!url) continue;

      // Check if this hook is subscribed to this event
      const subscribedEvents = config?.events || [];
      if (subscribedEvents.length > 0 && !subscribedEvents.includes(event)) {
        continue;
      }

      try {
        const secret = config?.secret;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'NuCRM-Webhook/1.0',
          'X-NuCRM-Event': event,
          'X-NuCRM-Delivery': randomUUID(),
        };
        if (secret) {
          headers['X-NuCRM-Signature'] = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
        }

        // Create delivery record
        const [delivery] = await db.insert(webhookQueue).values({
          webhookId: hook.id,
          url,
          method: 'POST',
          headers,
          payload: payloadObj,
          status: 'pending',
          attempt: 0,
        }).returning();

        if (!delivery) continue;

        const res = await fetch(url, { 
          method: 'POST', 
          headers, 
          body: payload, 
          signal: AbortSignal.timeout(10_000) 
        });

        if (res.ok) {
          await db.update(webhookQueue)
            .set({
              status: 'success',
              responseStatus: res.status,
              deliveredAt: new Date(),
            })
            .where(eq(webhookQueue.id, delivery.id));
        } else {
          const responseBody = await res.text().catch(() => '');
          const retryDelay = getRetryDelay(1);
          await db.update(webhookQueue)
            .set({
              status: 'failed',
              responseStatus: res.status,
              responseBody: responseBody.slice(0, 1000),
              nextRetryAt: new Date(Date.now() + retryDelay),
            })
            .where(eq(webhookQueue.id, delivery.id));
        }

        await db.update(integrations)
          .set({ lastUsedAt: new Date() })
          .where(eq(integrations.id, hook.id))
          .catch(() => {});
          
      } catch (err: any) {
        logger.warn(`[webhook] ${hook.name} delivery error: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[webhooks] ${err.message}`);
  }
}

/** Retry failed webhook deliveries from the webhook_deliveries table */
export async function retryFailedWebhooks(): Promise<number> {
  try {
    const failed = await db.select()
      .from(webhookQueue)
      .where(and(
        eq(webhookQueue.status, 'failed'),
        lt(webhookQueue.attempt, MAX_RETRIES),
        lte(webhookQueue.nextRetryAt, new Date())
      ))
      .orderBy(asc(webhookQueue.createdAt))
      .limit(50);
      
    if (!failed.length) return 0;

    let retried = 0;
    for (const item of failed) {
      try {
        const headers = (item.headers as Record<string, string>) || {};
        const res = await fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(item.payload),
          signal: AbortSignal.timeout(10_000),
        });
        
        if (res.ok) {
          await db.update(webhookQueue)
            .set({
              status: 'success',
              responseStatus: res.status,
              deliveredAt: new Date(),
            })
            .where(eq(webhookQueue.id, item.id));
          retried++;
        } else {
          const nextAttempt = item.attempt + 1;
          const retryDelay = getRetryDelay(nextAttempt);
          const isDeadLetter = retryDelay < 0 || nextAttempt >= MAX_RETRIES;

          await db.update(webhookQueue)
            .set({
              attempt: nextAttempt,
              responseStatus: res.status,
              status: isDeadLetter ? 'dead_letter' : 'failed',
              nextRetryAt: isDeadLetter ? null : new Date(Date.now() + retryDelay),
            })
            .where(eq(webhookQueue.id, item.id));
        }
      } catch (err: any) {
        const nextAttempt = item.attempt + 1;
        const retryDelay = getRetryDelay(nextAttempt);
        const isDeadLetter = retryDelay < 0 || nextAttempt >= MAX_RETRIES;

        await db.update(webhookQueue)
          .set({
            attempt: nextAttempt,
            errorMessage: err.message,
            status: isDeadLetter ? 'dead_letter' : 'failed',
            nextRetryAt: isDeadLetter ? null : new Date(Date.now() + retryDelay),
          })
          .where(eq(webhookQueue.id, item.id));
      }
    }
    return retried;
  } catch (err: unknown) {
    logger.error('[webhooks] Retry failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}
