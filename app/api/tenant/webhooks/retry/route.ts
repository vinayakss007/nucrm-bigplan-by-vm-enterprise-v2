import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';

/**
 * POST /api/tenant/webhooks/retry
 * Retry a failed webhook delivery.
 *
 * Body: { delivery_id: string }
 *
 * Fetches the original payload from webhook_deliveries and re-sends it.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'webhook-retry', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await readJsonBody(request);
    const { delivery_id } = body as { delivery_id?: string };

    if (!delivery_id) {
      return NextResponse.json({ error: 'delivery_id required' }, { status: 400 });
    }

    // Fetch the failed delivery
    const deliveryResult = await db.execute(sql`
      SELECT id, webhook_id, payload, url, headers, status, attempts
      FROM webhook_deliveries
      WHERE id = ${delivery_id}
        AND tenant_id = ${ctx.tenantId}
        AND status IN ('failed', 'error')
      LIMIT 1
    `);

    if (!deliveryResult.rows?.[0]) {
      return NextResponse.json({ error: 'Delivery not found or not in failed state' }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = deliveryResult.rows[0] as any;

    // Re-send the webhook
    try {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof row.headers === 'object' ? row.headers : {}),
        },
        body: typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      const newStatus = res.ok ? 'delivered' : 'failed';
      const responseStatus = res.status;

      // Update delivery status
      await db.execute(sql`
        UPDATE webhook_deliveries
        SET status = ${newStatus},
            response_status = ${responseStatus},
            attempts = COALESCE(attempts, 0) + 1,
            last_attempt_at = NOW(),
            delivered_at = CASE WHEN ${newStatus} = 'delivered' THEN NOW() ELSE NULL END
        WHERE id = ${delivery_id}
      `);

      return NextResponse.json({
        data: {
          delivery_id,
          status: newStatus,
          response_status: responseStatus,
          retried_at: new Date().toISOString(),
        },
      });
    } catch (fetchErr) {
      // Network error
      await db.execute(sql`
        UPDATE webhook_deliveries
        SET attempts = COALESCE(attempts, 0) + 1,
            last_attempt_at = NOW(),
            error_message = ${fetchErr instanceof Error ? fetchErr.message : 'Network error'}
        WHERE id = ${delivery_id}
      `);

      return NextResponse.json({
        data: {
          delivery_id,
          status: 'failed',
          error: fetchErr instanceof Error ? fetchErr.message : 'Network error',
          retried_at: new Date().toISOString(),
        },
      });
    }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
