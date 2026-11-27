/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError, notFound } from '@/lib/api-error';
import { customPlugins } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { verifyWebhookSignature, isWebhookTimestampValid, handleInboundWebhook } from '@/lib/plugins/webhook-handler';
import { logError } from '@/lib/errors-server';
import { isUuid } from '@/lib/id';
import { withPluginWebhookLookupContext, setPluginWebhookTenantContext } from '@/lib/db/plugin-webhook-context';
import { incr } from '@/lib/cache';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

/** Fixed-window counter in the shared cache: a fleet gets one budget per plugin. */
export async function isRateLimited(pluginId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const key = `webhook-rate:${pluginId}:${window}`;
  const count = await incr(key, Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
  return count > RATE_LIMIT_MAX;
}

/**
 * Inbound webhook receiver. Anonymous by design — the URL and the HMAC are the
 * authentication — so every read here happens before the caller is known.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    if (await isRateLimited(id)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    // `custom_plugins.id` is a uuid column and 0139 casts the claim, so anything else can
    // only be a typo — answer it here rather than as a 22P02 on a public endpoint (#2288).
    if (!isUuid(id)) {
      return notFound('Plugin');
    }

    // Read the body and its headers before opening the transaction: a caller who dribbles
    // the request would otherwise hold a pooled connection for as long as it likes, on the
    // one route here that needs no session to reach.
    const timestampHeader = request.headers.get('x-webhook-timestamp');
    if (!isWebhookTimestampValid(timestampHeader)) {
      return NextResponse.json({ error: 'Webhook timestamp too old' }, { status: 400 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature') ?? request.headers.get('x-hub-signature-256');

    return await withPluginWebhookLookupContext(id, async (tx) => {
      const [plugin] = await tx
        .select({
          // PP-061: 4 of the table's 19 columns. authConfig, customHeaders and baseUrl
          // hold this plugin's own upstream credentials and have no reader here.
          id: customPlugins.id,
          tenantId: customPlugins.tenantId,
          status: customPlugins.status,
          webhookSecret: customPlugins.webhookSecret,
        })
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

      // Fail closed: a plugin with no secret cannot be verified, so it gets no writes at all.
      if (!plugin.webhookSecret && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 403 });
      }

      const verified = verifyWebhookSignature(rawBody, signature, plugin.webhookSecret);

      if (!verified) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
      }

      let body: unknown = rawBody;
      try {
        body = JSON.parse(rawBody);
      } catch (err) {
        await logError({ error: err, context: 'plugins webhook parse error', requestMethod: 'POST' });
      }

      // Allowlist, not a copy of every header: this lands in plugin_execution_logs,
      // where an `authorization` echo would be a credential at rest.
      const headers: Record<string, string> = {};
      const headerKeys = ['content-type', 'x-webhook-signature', 'x-hub-signature-256', 'x-request-id', 'user-agent'];
      for (const key of headerKeys) {
        const value = request.headers.get(key);
        if (value) headers[key] = value;
      }

      // The claim has returned what it was opened for. Hand the rest of the request to
      // the plugin's own tenant so the log write runs under tenant_isolation.
      await setPluginWebhookTenantContext(tx, plugin.tenantId);

      const result = await handleInboundWebhook(tx, plugin.id, plugin.tenantId, {
        pluginId: plugin.id,
        headers,
        body,
        receivedAt: new Date().toISOString(),
        verified,
      });

      return NextResponse.json({ acknowledged: result.acknowledged, id: result.id });
    });
  } catch (err: unknown) {
    return apiError(err);
  }
}
