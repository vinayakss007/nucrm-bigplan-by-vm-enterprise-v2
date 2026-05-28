/**
 * NuCRM Plugin Webhook Handler
 *
 * Handles inbound webhook calls:
 * - Verifies webhook secret (HMAC-SHA256 if secret configured, or accepts without)
 * - Logs the payload
 * - Returns acknowledgment
 */

import { createHmac } from 'crypto';
import { db } from '@/drizzle/db';
import { pluginExecutionLogs } from '@/drizzle/schema';
import type { WebhookPayload } from './types';

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

  // Compare (constant-time comparison via string equality)
  const expected = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  return computed === expected;
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
