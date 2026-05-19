import { createHmac, randomUUID } from 'crypto';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';
import { eq, and, lte, lt, sql, asc } from 'drizzle-orm';
import { logger } from '@/lib/logger';

export type WebhookEvent =
  | 'contact.created' | 'contact.updated' | 'contact.deleted'
  | 'deal.created'    | 'deal.updated'    | 'deal.stage_changed' | 'deal.won' | 'deal.lost'
  | 'task.created'    | 'task.completed'
  | 'company.created';

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
      const config = hook.config as any;
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
          await db.update(webhookQueue)
            .set({
              status: 'failed',
              responseStatus: res.status,
              responseBody: responseBody.slice(0, 1000),
              nextRetryAt: new Date(Date.now() + 3600000), // Retry in 1 hour
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
        lt(webhookQueue.attempt, 3),
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
          await db.update(webhookQueue)
            .set({
              attempt: item.attempt + 1,
              responseStatus: res.status,
              nextRetryAt: new Date(Date.now() + 3600000),
            })
            .where(eq(webhookQueue.id, item.id));
        }
      } catch (err: any) {
        await db.update(webhookQueue)
          .set({
            attempt: item.attempt + 1,
            errorMessage: err.message,
            nextRetryAt: new Date(Date.now() + 3600000),
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
