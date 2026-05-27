// Background Worker for NuCRM SaaS
// Handles scheduled jobs, email sending, webhook delivery, etc.

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { db } from '@/drizzle/db';
import { notifications, contacts, activities, webhookDeliveries } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

if (!process.env['REDIS_URL']) {
  console.error('[Worker] FATAL: REDIS_URL is not set. Worker requires Redis to function.');
  console.error('[Worker] Set REDIS_URL=redis://host:6379 in your environment.');
  process.exit(1);
}

const connection = new IORedis(REDIS_URL, {
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

connection.on('error', (err) => {
  console.error('[Worker] Redis connection error:', err.message);
});

connection.on('connect', () => {
  console.log('[Worker] Redis connected successfully');
});

connection.on('reconnecting', () => {
  console.warn('[Worker] Redis reconnecting...');
});

console.log('[Worker] Background worker starting...');
console.log('[Worker] Redis URL:', REDIS_URL.replace(/\/\/.*:.*@/, '//*****@'));

// Heartbeat MUST be declared before signal handlers to avoid ReferenceError on shutdown
const heartbeatInterval = setInterval(() => {
  console.log('[Worker] Heartbeat - workers are running');
}, 60000);

// Email queue worker
const emailWorker = new Worker(
  'send-email',
  async (job) => {
    const { to, subject, body, html, tenantId } = job.data;
    console.log(`[Email Worker] Processing job: ${job.id} - Sending email to ${to}`);
    
    try {
      const { sendEmail } = await import('@/lib/email/service');
      const result = await sendEmail({
        to,
        subject,
        html: html || body,
        text: body,
      });
      
      console.log(`[Email Worker] Email sent successfully to ${to}`);
      return { sent: true, to, messageId: result?.messageId };
    } catch (error: any) {
      console.error(`[Email Worker] Failed to send email to ${to}:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
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
    } catch (error: any) {
      console.error(`[Notification Worker] Failed to send notification:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

// Bulk emails worker
// FIXED: Process emails in parallel batches of 10 instead of sequentially
const BULK_BATCH_SIZE = 10;

const bulkEmailWorker = new Worker(
  'send-bulk-emails',
  async (job) => {
    const { recipients, subject, body, tenantId } = job.data;
    console.log(`[Bulk Email Worker] Processing job: ${job.id} - Sending to ${recipients.length} recipients`);
    
    const results: Array<{ email: string; success: boolean; error?: string }> = [];
    const { sendEmail } = await import('@/lib/email/service');

    // Process in parallel batches to reduce total time
    for (let i = 0; i < recipients.length; i += BULK_BATCH_SIZE) {
      const batch = recipients.slice(i, i + BULK_BATCH_SIZE);
      const batchResults = await Promise.allSettled(
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
          console.error(`[Bulk Email Worker] Failed for ${recipient.email}:`, result.reason?.message);
          results.push({ email: recipient.email, success: false, error: result.reason?.message });
        }
      }
    }
    
    console.log(`[Bulk Email Worker] Completed: ${results.filter(r => r.success).length}/${results.length} sent`);
    return { total: recipients.length, success: results.filter(r => r.success).length, results };
  },
  { connection, concurrency: 3 }
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
    } catch (error: any) {
      console.error(`[Automation Worker] Failed:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

// Webhook delivery worker
const webhookWorker = new Worker(
  'webhooks',
  async (job) => {
    const { url, payload, headers, webhookId, deliveryId } = job.data;
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
    } catch (error: any) {
      console.error(`[Webhook Worker] Failed to deliver webhook:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, shutting down gracefully...');
  clearInterval(heartbeatInterval);
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    bulkEmailWorker.close(),
    automationWorker.close(),
    webhookWorker.close(),
  ]);
  await connection.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] SIGINT received, shutting down gracefully...');
  clearInterval(heartbeatInterval);
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    bulkEmailWorker.close(),
    automationWorker.close(),
    webhookWorker.close(),
  ]);
  await connection.quit();
  process.exit(0);
});
