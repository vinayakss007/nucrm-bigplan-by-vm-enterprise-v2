import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { webhookQueue } from '@/drizzle/schema/support';
import { webhooks } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const data = await db
      .select({
        id: webhookQueue.id,
        event: sql<string>`${webhookQueue.payload}->>'event'`,
        status: webhookQueue.status,
        response_code: webhookQueue.responseStatus,
        attempts: webhookQueue.attempt,
        delivered_at: webhookQueue.deliveredAt,
        next_retry_at: webhookQueue.nextRetryAt,
        created_at: webhookQueue.createdAt
      })
      .from(webhookQueue)
      .innerJoin(webhooks, eq(webhooks.id, webhookQueue.webhookId))
      .where(and(eq(webhookQueue.webhookId, id), eq(webhooks.tenantId, ctx.tenantId)))
      .orderBy(desc(webhookQueue.createdAt))
      .limit(50);

    return NextResponse.json({ data });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
