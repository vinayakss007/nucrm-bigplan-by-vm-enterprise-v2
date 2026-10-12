/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { safeFetch } from '@/lib/security/ssrf';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { webhookSignature } from '@/lib/webhooks';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) => {
  try {
    const limited = await rateLimitMutating(req, 'webhooks', 'test');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    // #2390 deleted a webhook with a `deleted_at` tombstone, so this read needs
    // the same filter the delivery path gained — otherwise "Send test" keeps
    // POSTing to an integration the customer already deleted.
    const webhook = await db.query.integrations.findFirst({
      where: and(
        eq(integrations.id, id),
        eq(integrations.tenantId, ctx.tenantId),
        eq(integrations.type, 'webhook'),
        isNull(integrations.deletedAt),
      ),
    });

    if (!webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    const config = (webhook.config ?? {}) as Record<string, unknown>;
    const url = config['url'] as string;
    const secret = typeof config['secret'] === 'string' && config['secret'].length > 0
      ? config['secret']
      : undefined;

    if (!url) return NextResponse.json({ error: 'No URL configured' }, { status: 400 });

    const testPayload = {
      id: crypto.randomUUID(),
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      tenant_id: ctx.tenantId,
      data: {
        message: 'This is a test webhook delivery from NuCRM',
        webhook_id: webhook.id,
        webhook_name: webhook.name,
      },
    };

    const bodyStr = JSON.stringify(testPayload);

    // #2399: this route signed `SHA-256(body ‖ secret)` while every real
    // delivery sends `HMAC-SHA256`, so a receiver that verified correctly for
    // live events rejected the test — and the button reported `failed` for a
    // webhook that was configured perfectly. One helper, one scheme.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-NuCRM-Event': 'webhook.test',
      'User-Agent': 'NuCRM-Webhook/1.0',
    };
    // No secret ⇒ no header at all, matching `fireWebhooks`: an empty
    // `sha256=` invites the receiver to verify an empty digest instead of
    // taking its unsigned-webhook path.
    if (secret) headers['X-NuCRM-Signature'] = webhookSignature(secret, bodyStr);

    const start = Date.now();
    let statusCode: number | null = null;
    let responseBody = '';
    let status: string;
    let errorMessage: string | null = null;

    try {
      const res = await safeFetch(url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(30_000),
      });
      statusCode = res.status;
      responseBody = await res.text().catch(() => '');
      status = res.ok ? 'delivered' : 'failed';
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
      status = 'failed';
    }

    const duration = Date.now() - start;

    return NextResponse.json({
      data: {
        status,
        statusCode,
        duration,
        errorMessage,
        responseBody: responseBody.slice(0, 1000),
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
});
