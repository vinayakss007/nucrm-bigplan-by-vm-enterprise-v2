import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { safeFetch } from '@/lib/security/ssrf';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    const webhook = await db.query.integrations.findFirst({
      where: and(eq(integrations.id, id), eq(integrations.tenantId, ctx.tenantId), eq(integrations.type, 'webhook')),
    });

    if (!webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });

    const config = (webhook.config ?? {}) as Record<string, unknown>;
    const url = config['url'] as string;
    const secret = config['secret'] as string;

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
    const signature = secret
      ? 'sha256=' + Array.from(
          new Uint8Array(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyStr + secret))
          )
        ).map(b => b.toString(16).padStart(2, '0')).join('')
      : '';

    const start = Date.now();
    let statusCode: number | null = null;
    let responseBody = '';
    let status: string;
    let errorMessage: string | null = null;

    try {
      const res = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NuCRM-Signature': signature,
          'X-NuCRM-Event': 'webhook.test',
          'User-Agent': 'NuCRM-Webhook/1.0',
        },
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
}
