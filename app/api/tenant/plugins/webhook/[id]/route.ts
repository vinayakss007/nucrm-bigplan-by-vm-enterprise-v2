import { NextRequest, NextResponse } from 'next/server';
import { apiError, notFound } from '@/lib/api-error';
import { db } from '@/drizzle/db';
import { customPlugins } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyWebhookSignature, isWebhookTimestampValid, handleInboundWebhook } from '@/lib/plugins/webhook-handler';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Simple in-memory rate limiter (sliding window, 60 requests per minute per plugin ID).
 */
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

function isRateLimited(pluginId: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateLimitMap.get(pluginId);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(pluginId, timestamps);
  }

  // Remove entries outside the window
  const filtered = timestamps.filter((t) => t > windowStart);
  rateLimitMap.set(pluginId, filtered);

  if (filtered.length >= RATE_LIMIT_MAX) {
    return true;
  }

  filtered.push(now);
  return false;
}

/**
 * Inbound webhook receiver for custom plugins.
 * No auth required (webhooks come from external services).
 * Uses HMAC-SHA256 signature verification if a webhook secret is configured.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Rate limit check
    if (isRateLimited(id)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // Fetch the plugin (no tenant auth needed - webhook URL acts as authentication)
    const [plugin] = await db.select()
      .from(customPlugins)
      .where(and(
        eq(customPlugins.id, id),
        isNull(customPlugins.deletedAt)
      ))
      .limit(1);

    if (!plugin) {
      return notFound('Plugin');
    }

    if (plugin.status === 'disabled') {
      return NextResponse.json({ error: 'Plugin is disabled' }, { status: 400 });
    }

    // Replay protection: check webhook timestamp if provided
    const timestampHeader = request.headers.get('x-webhook-timestamp');
    if (!isWebhookTimestampValid(timestampHeader)) {
      return NextResponse.json({ error: 'Webhook timestamp too old' }, { status: 400 });
    }

    // Read the raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature') ?? request.headers.get('x-hub-signature-256');

    // Verify webhook signature
    const verified = verifyWebhookSignature(rawBody, signature, plugin.webhookSecret);

    if (!verified) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    // Parse body
    let body: unknown = rawBody;
    try {
      body = JSON.parse(rawBody);
    } catch (err) {
      console.error('[plugins] webhook parse error', err);
    }

    // Extract relevant headers
    const headers: Record<string, string> = {};
    const headerKeys = ['content-type', 'x-webhook-signature', 'x-hub-signature-256', 'x-request-id', 'user-agent'];
    for (const key of headerKeys) {
      const value = request.headers.get(key);
      if (value) headers[key] = value;
    }

    // Process the webhook
    const result = await handleInboundWebhook(plugin.id, plugin.tenantId, {
      pluginId: plugin.id,
      headers,
      body,
      receivedAt: new Date().toISOString(),
      verified,
    });

    return NextResponse.json({ acknowledged: result.acknowledged, id: result.id });
  } catch (err: unknown) {
    return apiError(err);
  }
}
