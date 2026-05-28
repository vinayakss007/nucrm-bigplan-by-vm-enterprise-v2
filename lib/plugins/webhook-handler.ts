/**
 * NuCRM Plugin Webhook Handler
 *
 * Handles inbound webhook calls:
 * - Verifies webhook secret (HMAC-SHA256 if secret configured, or accepts without)
 * - Logs the payload
 * - Returns acknowledgment
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { db } from '@/drizzle/db';
import { pluginExecutionLogs } from '@/drizzle/schema';
import type { WebhookPayload } from './types';

/** Maximum age (in ms) for a webhook timestamp to be considered valid (5 minutes). */
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

/**
 * Verify an inbound webhook signature using HMAC-SHA256.
 * Returns true if no secret is configured (open webhook) or if signature matches.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string | null
): boolean {
  // If no secret configured, accept all payloads
  if (!secret) return true;

  // If secret configured but no signature provided, reject
  if (!signature) return false;

  // Compute HMAC-SHA256
  const computed = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Strip prefix if present
  const expected = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  // Constant-time comparison to prevent timing attacks
  const computedBuf = Buffer.from(computed, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');

  if (computedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(computedBuf, expectedBuf);
}

/**
 * Check if a webhook timestamp is within the acceptable window.
 * Returns true if no timestamp is provided (best-effort - not all webhooks include timestamps).
 * Returns false if the timestamp is older than 5 minutes.
 */
export function isWebhookTimestampValid(timestampHeader: string | null): boolean {
  if (!timestampHeader) return true; // Optional - accept if not provided

  const timestamp = Number(timestampHeader);
  if (Number.isNaN(timestamp)) return true; // Can't parse, allow through

  // Timestamp could be in seconds or milliseconds - normalize to ms
  const timestampMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  const age = Date.now() - timestampMs;

  return age <= MAX_WEBHOOK_AGE_MS;
}

/**
 * Process an inbound webhook and log it.
 */
export async function handleInboundWebhook(
  pluginId: string,
  tenantId: string,
  payload: WebhookPayload
): Promise<{ acknowledged: boolean; id?: string }> {
  try {
    const [logEntry] = await db.insert(pluginExecutionLogs).values({
      tenantId,
      pluginId,
      actionName: 'webhook_inbound',
      method: 'POST',
      url: `webhook://${pluginId}`,
      requestHeaders: payload.headers,
      requestBody: payload.body as Record<string, unknown> | null,
      responseStatus: 200,
      responseBody: null,
      durationMs: 0,
      success: payload.verified,
      errorMessage: payload.verified ? null : 'Webhook signature verification failed',
    }).returning();

    return { acknowledged: true, id: logEntry?.id };
  } catch (err) {
    console.error('[PluginWebhook] Failed to log webhook:', err);
    return { acknowledged: false };
  }
}
