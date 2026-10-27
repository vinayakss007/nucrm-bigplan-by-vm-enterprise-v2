/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Background Worker for NuCRM SaaS
// Handles scheduled jobs, email sending, webhook delivery, etc.

import { Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { and, desc, eq } from 'drizzle-orm';
import { integrations, leadWarmingMessages } from '@/drizzle/schema';
import { NO_USER_SENTINEL, withTenantContext, type RlsTransaction } from '@/lib/db/rls';
import { createNotification, type NotificationType } from '@/lib/notifications';
import { registerProcessErrorHandlers } from '@/lib/process-errors';
import { redactEmail, redactPhone, redactUrl } from '@/lib/logger/pii';
import { escapeHtml } from '@/lib/email/escape-html';
import { logError } from '@/lib/errors-server';
import { materializeFileSecrets } from '@/lib/secrets-file';
import { errorText } from '@/lib/error-redaction';

// #2123: read bind-mounted secret files into process.env before any config is
// captured below, so the worker can run without secrets in container metadata.
materializeFileSecrets();

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

      // #2998: sendEmail resolves with {success:false} on provider rejection
      // instead of throwing, so the old code marked rejected mail as sent.
      // Throwing hands the job back to BullMQ for its retry schedule.
      if (!result.success) {
        console.error(`[Email Worker] Rejected for ${maskedEmail}: ${result.error ?? 'unknown provider error'}`);
        throw new Error(result.error ?? 'Email rejected by provider');
      }

      console.log(`[Email Worker] Email sent successfully to ${maskedEmail}`);
      // #1288: the job return value is persisted in Redis (BullMQ completed
      // set). Never store the raw recipient address there — return the masked
      // form so PII does not sit in Redis.
      return { sent: true, to: maskedEmail, messageId: result?.messageId };
    } catch (error) {
      console.error(`[Email Worker] Failed to send email to ${maskedEmail}:`, errorText(error));
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
      // #3290: this used to be an insert into `notifications` on the pool, whose connections
      // `lib/db/pool.ts` has just cleared of every `app.*` GUC. `notifications` carries
      // tenant_isolation FOR ALL (0019) with
      // `WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid)`,
      // so every job raised 42501, was retried three times, and landed in the failed set — no
      // in-app notification was ever written. `createNotification` is the same insert with the
      // context already around it (`lib/notifications.ts`), and the one copy of that write: #3288
      // showed what happens when a second copy exists — one gets fixed and the other stays dead.
      //
      // Its `false` means "the row did not land after a retry". Returning `{sent:true}` for that
      // would be this issue's own failure shape, so the job fails and BullMQ's retry/failed set
      // sees a real reason.
      const stored = await createNotification({
        userId,
        tenantId,
        title,
        body: message,
        type: (type || 'system') as NotificationType,
        metadata: data || {},
      });
      if (!stored) {
        throw new Error(`[Notification Worker] notification for user ${userId} was not persisted (tenant ${tenantId})`);
      }

      console.log(`[Notification Worker] Notification sent to user ${userId}`);
      return { sent: true, userId };
    } catch (error) {
      console.error(`[Notification Worker] Failed to send notification:`, errorText(error));
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
    const { subject, body, tenantId: _tenantId } = job.data;
    type BulkEmailRecipient = { email: string; first_name?: string; last_name?: string };
    const recipients = (job.data.recipients ?? []) as BulkEmailRecipient[];
    console.log(`[Bulk Email Worker] Processing job: ${job.id} - Sending to ${recipients.length} recipients`);
    
    // #1292/#1288: the per-recipient result is returned from the processor and
    // persisted in the BullMQ completed set (Redis). Store the masked email so
    // no raw recipient address sits in Redis or shows up in a job dump.
    const results: Array<{ email: string; success: boolean; error?: string }> = [];
    const { sendEmail } = await import('@/lib/email/service');

    // Process in parallel batches to reduce total time
    for (let i = 0; i < recipients.length; i += BULK_BATCH_SIZE) {
      const batch = recipients.slice(i, i + BULK_BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (recipient) => {
          // #1170/#1191/#1272: HTML-escape first_name before interpolating it
          // into the HTML body, otherwise a contact name containing markup
          // (e.g. <script>) is injected verbatim — stored XSS in outgoing mail.
          // The plaintext part uses the raw value (no markup interpretation).
          const rawFirstName = recipient.first_name || '';
          const safeFirstName = escapeHtml(String(rawFirstName));
          const sendResult = await sendEmail({
            to: recipient.email,
            subject,
            html: body.replace(/\{first_name\}/g, safeFirstName),
            text: body.replace(/\{first_name\}/g, rawFirstName),
          });
          // #2998: a provider rejection comes back as {success:false}, never
          // throws — without this check every recipient was reported as sent.
          if (!sendResult.success) {
            throw new Error(sendResult.error ?? 'Email rejected by provider');
          }
          return { email: redactEmail(recipient.email), success: true };
        })
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]!;
        const recipient = batch[j]!;
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error(`[Bulk Email Worker] Failed for ${redactEmail(recipient.email)}:`, result.reason?.message);
          results.push({ email: redactEmail(recipient.email), success: false, error: result.reason?.message });
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
    } catch (error) {
      console.error(`[Automation Worker] Failed:`, errorText(error));
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
        //
        // #3290: the tenant id in a job payload is a *claim*, and until this line nothing checked
        // it. `lib/db/request-connection.ts` pins one context per HTTP request and there is no
        // request here, so every statement in this handler ran on a pool connection whose `app.*`
        // GUCs `lib/db/pool.ts` had cleared: the integration SELECT below matched zero rows, the
        // claim matched zero rows, and each zero was reported as a finding about the data instead
        // of a missing privilege. `withTenantContext` is what makes the claim a checked one.
        //
        // One short context per statement, deliberately not one transaction spanning the Meta
        // round-trip: `SET LOCAL` dies at COMMIT, and holding a pooled connection across a 15 s
        // HTTP call is how a queue stalls the pool.
        //
        // `NO_USER_SENTINEL` because the payload genuinely has no actor — a birthday greeting is
        // not sent by a logged-in user. `integrations` and `lead_warming_messages` are isolated by
        // 0031 on `app.current_tenant` alone, and the sentinel matches no `users` row, so any
        // policy keyed on the actor stays closed.
        const asTenant = <T>(fn: (tx: RlsTransaction) => Promise<T>): Promise<T> =>
          withTenantContext(tenantId, NO_USER_SENTINEL, fn);

        const byMessage = (status: 'queued' | 'sending') => and(
          eq(leadWarmingMessages.campaignId, campaignId),
          eq(leadWarmingMessages.contactId, contactId),
          eq(leadWarmingMessages.status, status),
          eq(leadWarmingMessages.channel, 'whatsapp')
        );

        const markFailed = (errorMessage: string, from: 'queued' | 'sending') =>
          asTenant((tx) => tx.update(leadWarmingMessages)
            .set({ status: 'failed', errorMessage })
            .where(byMessage(from)));

        const [integration] = await asTenant((tx) =>
          tx.select()
            .from(integrations)
            .where(and(
              eq(integrations.tenantId, tenantId),
              eq(integrations.type, 'whatsapp'),
              eq(integrations.isActive, true)
            ))
            .orderBy(desc(integrations.createdAt))
            .limit(1));

        if (!integration) {
          console.warn(`[Lead Warming] No WhatsApp integration for tenant ${tenantId}`);
          // Update message status
          await markFailed('WhatsApp not configured', 'queued');
          return { sent: false, error: 'WhatsApp not configured' };
        }

        type WhatsAppIntegrationConfig = { phone_number_id?: string; access_token?: string; token_expires_at?: string | number | Date | null; expires_at?: string | number | Date | null; [key: string]: unknown };
        const config = (integration.config ?? null) as WhatsAppIntegrationConfig | null;
        const phoneNumberId = config?.phone_number_id;
        const accessToken = config?.access_token;

        if (!phoneNumberId || !accessToken) {
          throw new Error('WhatsApp credentials incomplete');
        }

        // #1294: proactive expiry check. Meta access tokens expire (long-lived
        // tokens last ~60 days; system-user tokens can be set to never expire).
        // When the integration config carries a known expiry, honour it BEFORE
        // calling Meta so we fail fast with an actionable error instead of
        // burning an API round-trip on a token we already know is dead. This is
        // forward-compatible: the save flow can persist `token_expires_at`; when
        // absent we fall back to the reactive 401/190 detection below (unchanged
        // behaviour for existing integrations).
        const { isTokenExpired, getTokenExpiry, isStaleTokenResponse } = await import('@/lib/whatsapp/token');
        if (isTokenExpired(config)) {
          const expiresAt = getTokenExpiry(config)!;
          await logError({
            error: new Error(
              `WhatsApp access token expired at ${expiresAt.toISOString()} — re-connect the WhatsApp integration.`
            ),
            context: 'worker:lead-warming:whatsapp:token-expired',
            tenantId,
            level: 'error',
            metadata: { integrationId: integration.id, tokenExpiresAt: expiresAt.toISOString() },
          });
          await markFailed('WhatsApp token expired — re-connect the integration', 'queued');
          return { sent: false, error: 'WhatsApp token expired' };
        }

        // M-E: claim the message BEFORE sending. Atomically flip queued->sending
        // and only proceed if this attempt actually won the row. On a retry
        // (after a successful send whose status update didn't persist, or a
        // duplicate job) there is no 'queued' row left to claim, so we skip the
        // send instead of messaging the contact twice.
        const claimed = await asTenant((tx) =>
          tx.update(leadWarmingMessages)
            .set({ status: 'sending' })
            .where(byMessage('queued'))
            .returning({ id: leadWarmingMessages.id }));

        if (claimed.length === 0) {
          // #3290 ask 2: zero rows used to be read as "already processed", which is a *success-
          // looking* answer for the case where the row never existed — the same conflation that
          // made #3288's route answer `{"ok":true}` for a token it never created. So ask the row,
          // under the same checked context: a duplicate is a row in a terminal state, and anything
          // else fails the job loudly instead of logging a skip.
          const [row] = await asTenant((tx) =>
            tx.select({ id: leadWarmingMessages.id, status: leadWarmingMessages.status })
              .from(leadWarmingMessages)
              .where(and(
                eq(leadWarmingMessages.campaignId, campaignId),
                eq(leadWarmingMessages.contactId, contactId),
                eq(leadWarmingMessages.channel, 'whatsapp')
              ))
              .limit(1));

          if (!row) {
            throw new Error(
              `no-op claim: no lead_warming_messages row for campaign ${campaignId} ` +
              `contact ${contactId} in tenant ${tenantId}`
            );
          }
          console.log(`[Lead Warming] WhatsApp message already ${row.status} — skipping duplicate send`);
          return { sent: false, skipped: true, reason: 'already_processed' };
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
          const errMsg = errData.error?.message || `HTTP ${response.status}`;

          // #1294: the WhatsApp access_token stored in integration.config has no
          // refresh flow here — a long-lived Meta token still expires (or is
          // revoked), and once stale every send just fails. Meta signals this
          // with HTTP 401 and OAuthException code 190 (also 102/463 for
          // session/expiry cases). Surface it as a clear, actionable structured
          // error so an operator knows to re-connect WhatsApp, instead of the
          // failure being buried as a generic per-message error.
          // FOLLOW-UP: implement automatic Meta token refresh/rotation (out of
          // scope here — no refresh infrastructure exists yet).
          const errCode = errData.error?.code;
          const isStaleToken = isStaleTokenResponse(response.status, errCode);
          if (isStaleToken) {
            await logError({
              error: new Error(`WhatsApp access token stale/expired — re-connect the WhatsApp integration. (${errMsg})`),
              context: 'worker:lead-warming:whatsapp:stale-token',
              tenantId,
              level: 'error',
              metadata: {
                integrationId: integration.id,
                httpStatus: response.status,
                metaErrorCode: errCode,
              },
            });
          }

          // Release the claim back to failed so the failure is visible and the
          // row isn't stuck in 'sending'. (We do NOT requeue: the message may
          // have been delivered; a stuck 'sending' row is safer than a resend.)
          await markFailed(
            (isStaleToken ? `WhatsApp token expired: ${errMsg}` : errMsg).slice(0, 500),
            'sending'
          );
          throw new Error(errMsg);
        }

        // Update message status to sent (claimed as 'sending' above)
        await asTenant((tx) =>
          tx.update(leadWarmingMessages)
            .set({ status: 'sent', sentAt: new Date() })
            .where(byMessage('sending')));

        // Redact phone number in logs
        const maskedPhone = redactPhone(phone);
        console.log(`[Lead Warming] WhatsApp sent to ${maskedPhone} for ${eventName}`);
        return { sent: true, phone, event: eventName };
      }

      // For email type, it's already handled by send-email queue
      return { sent: true };
    } catch (error) {
      console.error(`[Lead Warming Worker] Failed:`, errorText(error));
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
    // #1293: redact the URL — webhook targets can carry tokens/keys in the query string.
    console.log(`[Webhook Worker] Processing job: ${job.id} - Delivering to ${redactUrl(url)}`);
    
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
    } catch (error) {
      console.error(`[Webhook Worker] Failed to deliver webhook:`, errorText(error));
      throw error;
    }
  },
  { connection: createRedisConnection(), concurrency: 5, ...JOB_RETENTION }
);

const tenantCleanupWorker = new Worker(
  'tenant-cleanup',
  async (job) => {
    const { tenantId } = job.data;
    console.log(`[Tenant Cleanup Worker] Processing job: ${job.id} - Cleaning up tenant ${tenantId}`);
    try {
      const { processTenantCleanup } = await import('@/lib/tenant-cleanup');
      await processTenantCleanup(tenantId);
      return { cleaned: true, tenantId };
    } catch (error) {
      console.error(`[Tenant Cleanup Worker] Failed to clean up tenant:`, errorText(error));
      throw error;
    }
  },
  { connection: createRedisConnection(), concurrency: 1, ...JOB_RETENTION }
);

// CSV export worker (#H1) — previously enqueued by enqueueExport() with NO
// consumer, so async exports were silently dropped. Generates the CSV
// (bounded by MAX_EXPORT_ROWS, #H2) and, when a callbackUrl was supplied,
// POSTs the result there so the requester is notified.
const exportWorker = new Worker(
  'export-csv',
  async (job) => {
    const { tenantId, userId } = job.data;
    const payload = job.data.payload ?? {};
    const entityType = payload.type;
    const filters = payload.filters ?? {};
    const callbackUrl = payload.callbackUrl as string | undefined;
    console.log(`[Export Worker] Processing job: ${job.id} - ${entityType} for tenant ${tenantId}`);

    const { generateExportData } = await import('@/lib/export');
    const csv = await generateExportData({ tenantId, userId, entityType, filters });

    if (callbackUrl) {
      // #H1: deliver the finished export to the requester's callback. redactUrl
      // keeps any token in the callback query string out of the logs.
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv; charset=utf-8' },
        body: csv,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Export callback failed: HTTP ${res.status}`);
      console.log(`[Export Worker] Delivered ${entityType} export to ${redactUrl(callbackUrl)}`);
    } else {
      console.warn(`[Export Worker] ${entityType} export for tenant ${tenantId} produced no callbackUrl — result not delivered`);
    }
    return { rows: csv.split('\n').length - 1, entityType };
  },
  { connection: createRedisConnection(), concurrency: 2, ...JOB_RETENTION }
);

// Contact import worker (#H1) — previously enqueued by enqueueContactImport()
// with NO consumer. Runs the SAME shared, tenant-scoped, plan-limit-aware
// import path as the synchronous endpoint (lib/import/contacts).
const contactImportWorker = new Worker(
  'contact-import',
  async (job) => {
    const { tenantId, userId } = job.data;
    const payload = job.data.payload ?? {};
    const csv: string = payload.csv ?? '';
    const options = payload.options ?? { skipDuplicates: true, updateExisting: false };
    console.log(`[Contact Import Worker] Processing job: ${job.id} for tenant ${tenantId}`);

    const { parseContactsCsv, processContactImport } = await import('@/lib/import/contacts');
    const rows = parseContactsCsv(csv);
    if (rows.length === 0) {
      console.warn(`[Contact Import Worker] No data rows in CSV for job ${job.id}`);
      return { imported: 0, updated: 0, skipped: 0, errors: ['No data rows found in CSV'] };
    }
    const results = await processContactImport(tenantId, userId, rows, options);
    console.log(`[Contact Import Worker] Job ${job.id}: imported=${results.imported} updated=${results.updated} skipped=${results.skipped}`);
    return results;
  },
  { connection: createRedisConnection(), concurrency: 2, ...JOB_RETENTION }
);

// ── Dead-letter / poison-message visibility (#M4) ────────────────────────────
// Previously a job that exhausted its retries just got evicted after 24h with
// NO alert — poison messages failed silently. Attach a QueueEvents('failed')
// listener per queue so a FINAL failure (attemptsMade >= configured attempts)
// is logged loudly and reported to the error pipeline for alerting.
const QUEUE_NAMES = [
  'send-email', 'send-notification', 'send-bulk-emails', 'run-automation',
  'send-lead-warming', 'whatsapp-webhook', 'webhooks', 'export-csv', 'contact-import',
  'tenant-cleanup',
] as const;

const queueEventsList: QueueEvents[] = [];
for (const name of QUEUE_NAMES) {
  const qe = new QueueEvents(name, { connection: createRedisConnection() });
  qe.on('failed', async ({ jobId, failedReason }) => {
    try {
      // Only alert on FINAL failure so we don't page for a job that will still
      // be retried. We fetch the job to compare attemptsMade against attempts.
      const { Queue } = await import('bullmq');
      const q = new Queue(name, { connection: createRedisConnection() });
      const job = jobId ? await q.getJob(jobId) : null;
      const attemptsMade = job?.attemptsMade ?? 0;
      const maxAttempts = job?.opts?.attempts ?? 1;
      await q.close();
      if (attemptsMade < maxAttempts) return; // will be retried; not dead yet

      console.error(`[DLQ] Job permanently failed in queue "${name}" (job ${jobId}): ${failedReason}`);
      await logError({
        error: new Error(`Background job permanently failed: ${failedReason}`),
        context: `worker:dlq:${name}`,
        level: 'error',
        metadata: { queue: name, jobId, attemptsMade, maxAttempts },
      });
    } catch (e) {
      console.error(`[DLQ] Failed to record dead-letter for queue "${name}":`, (e as Error).message);
    }
  });
  queueEventsList.push(qe);
}
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
        tenantCleanup: tenantCleanupWorker.isRunning(),
        export: exportWorker.isRunning(),
        contactImport: contactImportWorker.isRunning(),
      },
      timestamp: new Date().toISOString(),
    };
    await heartbeatConnection.set('worker:heartbeat', JSON.stringify(info), 'EX', 60);
  } catch {
    console.error('[worker] Heartbeat write failed');
  }
}, 30_000);

// Guard against double shutdown when both SIGTERM and SIGINT arrive.
let shuttingDown = false;

// Graceful shutdown — closes all workers, then quits every Redis connection
async function shutdown(signal: 'SIGTERM' | 'SIGINT') {
  if (shuttingDown) {
    console.log(`[Worker] ${signal} received, shutdown already in progress`);
    return;
  }
  shuttingDown = true;
  console.log(`[Worker] ${signal} received, shutting down gracefully...`);
  // Watchdog: force-exit if graceful shutdown hangs (e.g. a close/quit stalls).
  const forceExit = setTimeout(() => {
    console.error('[Worker] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
  forceExit.unref?.();
  clearInterval(heartbeatInterval);
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    bulkEmailWorker.close(),
    automationWorker.close(),
    leadWarmingWorker.close(),
    webhookWorker.close(),
    whatsappWebhookWorker.close(),
    tenantCleanupWorker.close(),
    exportWorker.close(),
    contactImportWorker.close(),
    ...queueEventsList.map((qe) => qe.close()),
  ]);
  await Promise.allSettled(
    redisConnections.map((conn) =>
      conn.quit().catch((err) => {
        console.error('[Worker] Error quitting Redis connection:', err.message);
        conn.disconnect();
      })
    )
  );
  clearTimeout(forceExit);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('SIGINT', () => shutdown('SIGINT'));
