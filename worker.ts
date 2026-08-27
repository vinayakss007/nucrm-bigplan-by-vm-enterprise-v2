/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Background Worker for NuCRM SaaS
// Handles scheduled jobs, email sending, webhook delivery, etc.

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { db } from '@/drizzle/db';
import { notifications } from '@/drizzle/schema';
import { registerProcessErrorHandlers } from '@/lib/process-errors';
import { redactEmail, redactPhone } from '@/lib/logger/pii';

registerProcessErrorHandlers('worker');

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

// Retention for finished jobs — without this the completed/failed sets grow
// unbounded and Redis slowly fills up (Issue #1182). Completed jobs are kept
// for 1 hour (max 1000) so dashboards can still show recent activity; failed
// jobs are kept 24h for post-mortem, then evicted by BullMQ on the next job.
const JOB_RETENTION = {
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
} as const;

// BullMQ Workers issue blocking Redis commands (BRPOPLPUSH/BZPOPMIN), so every
// worker MUST have its own dedicated connection — sharing one causes workers to
// block each other and stalls queues. maxRetriesPerRequest: null is required
// for blocking connections. Connections are tracked here so they can be closed
// on shutdown (BullMQ does not close user-supplied connections).
const redisConnections: IORedis[] = [];

function createRedisConnection(): IORedis {
  const conn = new IORedis(REDIS_URL, {
    // Required: null so blocking commands never reject on retry limit
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      if (times > 20) {
        console.error(`[Worker] Redis connection failed after ${times} retries. Exiting.`);
        process.exit(1);
      }
      const delay = Math.min(times * 500, 30_000);
      console.warn(`[Worker] Redis retry #${times} in ${delay}ms...`);
      return delay;
    },
    reconnectOnError: (err) => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some(e => err.message.includes(e));
    },
  });

  conn.on('error', (err) => {
    console.error('[Worker] Redis connection error:', err.message);
  });

  conn.on('connect', () => {
    console.log('[Worker] Redis connected successfully');
  });

  conn.on('reconnecting', () => {
    console.warn('[Worker] Redis reconnecting...');
  });

  redisConnections.push(conn);
  return conn;
}

// Separate non-blocking connection for the health-check heartbeat writes
const heartbeatConnection = createRedisConnection();

console.log('[Worker] Background worker starting...');
console.log('[Worker] Redis URL:', REDIS_URL.replace(/\/\/.*:.*@/, '//*****@'));

const startTime = Date.now();
// Email queue worker
const emailWorker = new Worker(
  'send-email',
  async (job) => {
    const { to, subject, body, html, tenantId: _tenantId } = job.data;
    // Redact PII in logs
    const maskedEmail = redactEmail(to);
    console.log(`[Email Worker] Processing job: ${job.id} - Sending email to ${maskedEmail}`);
    
    try {
      const { sendEmail } = await import('@/lib/email/service');
      const result = await sendEmail({
        to,
        subject,
        html: html || body,
        text: body,
      });
      
      console.log(`[Email Worker] Email sent successfully to ${maskedEmail}`);
      // #1288: the job return value is persisted in Redis (BullMQ completed
      // set). Never store the raw recipient address there — return the masked
      // form so PII does not sit in Redis.
      return { sent: true, to: maskedEmail, messageId: result?.messageId };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(`[Email Worker] Failed to send email to ${maskedEmail}:`, error.message);
      throw error;
    }
  },
  { connection: createRedisConnection(), concurrency: 5, ...JOB_RETENTION }
);

// Notification queue worker
const notificationWorker = new Worker(
  'send-notification',
  async (job) => {
    const { userId, tenantId, title, message, type, data } = job.data;
    console.log(`[Notification Worker] Processing job: ${job.id} - Sending notification to user ${userId}`);
    
    try {
      await db.insert(notifications).values({
        userId,
        tenantId,
        title,
        body: message,
        type: type || 'system',
        metadata: data || {},
      });
      
      console.log(`[Notification Worker] Notification sent to user ${userId}`);
      return { sent: true, userId };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(`[Notification Worker] Failed to send notification:`, error.message);
      throw error;
    }
  },
  { connection: createRedisConnection(), concurrency: 5, ...JOB_RETENTION }
);

// Bulk emails worker
// FIXED: Process emails in parallel batches of 10 instead of sequentially
const BULK_BATCH_SIZE = 10;

const bulkEmailWorker = new Worker(
  'send-bulk-emails',
  async (job) => {
    const { recipients, subject, body, tenantId: _tenantId } = job.data;
    console.log(`[Bulk Email Worker] Processing job: ${job.id} - Sending to ${recipients.length} recipients`);
    
    const results: Array<{ email: string; success: boolean; error?: string }> = [];
    const { sendEmail } = await import('@/lib/email/service');

    // Process in parallel batches to reduce total time
    for (let i = 0; i < recipients.length; i += BULK_BATCH_SIZE) {
      const batch = recipients.slice(i, i + BULK_BATCH_SIZE);
      const batchResults = await Promise.allSettled(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        batch.map(async (recipient: any) => {
          await sendEmail({
            to: recipient.email,
            subject,
            html: body.replace(/\{first_name\}/g, recipient.first_name || ''),
            text: body.replace(/\{first_name\}/g, recipient.first_name || ''),
          });
          return { email: recipient.email, success: true };
        })
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]!;
        const recipient = batch[j]!;
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error(`[Bulk Email Worker] Failed for ${redactEmail(recipient.email)}:`, result.reason?.message);
          results.push({ email: recipient.email, success: false, error: result.reason?.message });
        }
      }
    }
    
    console.log(`[Bulk Email Worker] Completed: ${results.filter(r => r.success).length}/${results.length} sent`);
    return { total: recipients.length, success: results.filter(r => r.success).length, results };
  },
  { connection: createRedisConnection(), concurrency: 3, ...JOB_RETENTION }
);

// Automation queue worker
const automationWorker = new Worker(
  'run-automation',
  async (job) => {
    const { automationId, contactId, dealId, tenantId, triggerData, eventType } = job.data;
    console.log(`[Automation Worker] Processing job: ${job.id} - Automation ${automationId}`);
    
    try {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      await evaluateAutomations({
        tenantId,
        event: eventType || 'contact.created',
        data: triggerData || {},
        contactId: contactId || undefined,
        dealId: dealId || undefined,
      });
      
      console.log(`[Automation Worker] Automation ${automationId} completed successfully`);
      return { success: true, automationId };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(`[Automation Worker] Failed:`, error.message);
      throw error;
    }
  },
  { connection: createRedisConnection(), concurrency: 5, ...JOB_RETENTION }
);

// Lead warming worker (premium feature: auto-send festival/birthday greetings)
const leadWarmingWorker = new Worker(
  'send-lead-warming',
  async (job) => {
    const { type, tenantId, campaignId, contactId, phone, message, templateName, eventName } = job.data;
    console.log(`[Lead Warming Worker] Processing job: ${job.id} - ${type} for ${contactId}`);

    try {
      if (type === 'whatsapp') {
        // Send WhatsApp via Meta Cloud API
        const { db: database } = await import('@/drizzle/db');
        const { integrations, leadWarmingMessages } = await import('@/drizzle/schema');
        const { eq: eqOp, and: andOp, desc: descOp } = await import('drizzle-orm');

        const [integration] = await database.select()
          .from(integrations)
          .where(andOp(
            eqOp(integrations.tenantId, tenantId),
            eqOp(integrations.type, 'whatsapp'),
            eqOp(integrations.isActive, true)
          ))
          .orderBy(descOp(integrations.createdAt))
          .limit(1);

        if (!integration) {
          console.warn(`[Lead Warming] No WhatsApp integration for tenant ${tenantId}`);
          // Update message status
          await database.update(leadWarmingMessages)
            .set({ status: 'failed', errorMessage: 'WhatsApp not configured' })
            .where(andOp(
              eqOp(leadWarmingMessages.campaignId, campaignId),
              eqOp(leadWarmingMessages.contactId, contactId),
              eqOp(leadWarmingMessages.status, 'queued')
            ));
          return { sent: false, error: 'WhatsApp not configured' };
        }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const config = integration.config as any;
        const phoneNumberId = config?.phone_number_id;
        const accessToken = config?.access_token;

        if (!phoneNumberId || !accessToken) {
          throw new Error('WhatsApp credentials incomplete');
        }

        const requestBody = templateName
          ? {
              messaging_product: 'whatsapp',
              to: phone.replace(/[^0-9]/g, ''),
              type: 'template',
              template: { name: templateName, language: { code: 'en' } },
            }
          : {
              messaging_product: 'whatsapp',
              to: phone.replace(/[^0-9]/g, ''),
              type: 'text',
              text: { body: message },
            };

        const response = await fetch(
          `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(15_000),
          }
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
          throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        // Update message status to sent
        await database.update(leadWarmingMessages)
          .set({ status: 'sent', sentAt: new Date() })
          .where(andOp(
            eqOp(leadWarmingMessages.campaignId, campaignId),
            eqOp(leadWarmingMessages.contactId, contactId),
            eqOp(leadWarmingMessages.status, 'queued'),
            eqOp(leadWarmingMessages.channel, 'whatsapp')
          ));

        // Redact phone number in logs
        const maskedPhone = redactPhone(phone);
        console.log(`[Lead Warming] WhatsApp sent to ${maskedPhone} for ${eventName}`);
        return { sent: true, phone, event: eventName };
      }

      // For email type, it's already handled by send-email queue
      return { sent: true };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(`[Lead Warming Worker] Failed:`, error.message);
      throw error;
    }
  },
  { connection: createRedisConnection(), concurrency: 3, ...JOB_RETENTION }
);

// WhatsApp webhook worker (#1256) — retried consumption of inbound
// payloads; the API route enqueues here and falls back to inline only if
// the queue is unreachable.
const whatsappWebhookWorker = new Worker(
  'whatsapp-webhook',
  async (job) => {
    const { processWhatsAppPayload } = await import('@/lib/whatsapp/webhook-processor');
    await processWhatsAppPayload(job.data);
  },
  { connection: createRedisConnection(), concurrency: 2, ...JOB_RETENTION }
);

// Webhook delivery worker
const webhookWorker = new Worker(
  'webhooks',
  async (job) => {
    const { url, payload, headers, webhookId: _webhookId, deliveryId } = job.data;
    console.log(`[Webhook Worker] Processing job: ${job.id} - Delivering to ${url}`);
    
    try {
      const { processWebhookDelivery } = await import('@/lib/webhooks/delivery');
      
      if (deliveryId) {
        await processWebhookDelivery(deliveryId);
        return { delivered: true, deliveryId };
      }
      
      // Direct send fallback
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return { delivered: true, url, status: response.status };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(`[Webhook Worker] Failed to deliver webhook:`, error.message);
      throw error;
    }
  },
  { connection: createRedisConnection(), concurrency: 5, ...JOB_RETENTION }
);

// Health check heartbeat — writes worker status to Redis every 30s
const heartbeatInterval = setInterval(async () => {
  try {
    const info = {
      pid: process.pid,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      memory: process.memoryUsage(),
      node: process.version,
      status: 'running',
      workers: {
        email: emailWorker.isRunning(),
        notification: notificationWorker.isRunning(),
        bulkEmail: bulkEmailWorker.isRunning(),
        automation: automationWorker.isRunning(),
        leadWarming: leadWarmingWorker.isRunning(),
        webhook: webhookWorker.isRunning(),
        whatsappWebhook: whatsappWebhookWorker.isRunning(),
      },
      timestamp: new Date().toISOString(),
    };
    await heartbeatConnection.set('worker:heartbeat', JSON.stringify(info), 'EX', 60);
  } catch {
    console.error('[worker] Heartbeat write failed');
  }
}, 30_000);

// Graceful shutdown — closes all workers, then quits every Redis connection
async function shutdown(signal: 'SIGTERM' | 'SIGINT') {
  console.log(`[Worker] ${signal} received, shutting down gracefully...`);
  clearInterval(heartbeatInterval);
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    bulkEmailWorker.close(),
    automationWorker.close(),
    leadWarmingWorker.close(),
    webhookWorker.close(),
    whatsappWebhookWorker.close(),
  ]);
  await Promise.allSettled(
    redisConnections.map((conn) =>
      conn.quit().catch((err) => {
        console.error('[Worker] Error quitting Redis connection:', err.message);
        conn.disconnect();
      })
    )
  );
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('SIGINT', () => shutdown('SIGINT'));
