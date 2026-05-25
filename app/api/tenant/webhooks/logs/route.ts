import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { webhookQueue } from '@/drizzle/schema/support';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const statusFilter = searchParams.get('status');
    const offset = (page - 1) * limit;

    // Get the tenant's webhook integration IDs
    const tenantWebhooks = await db.select({ id: integrations.id })
      .from(integrations)
      .where(and(
        eq(integrations.tenantId, ctx.tenantId),
        eq(integrations.type, 'webhook')
      ));

    const webhookIds = tenantWebhooks.map(w => w.id);
    if (!webhookIds.length) {
      return NextResponse.json({ data: [], total: 0, page, limit });
    }

    // Build conditions
    const conditions = [inArray(webhookQueue.webhookId, webhookIds)];
    if (statusFilter) {
      conditions.push(eq(webhookQueue.status, statusFilter));
    }

    // Count total
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(webhookQueue)
      .where(and(...conditions));

    // Fetch paginated logs
    const logs = await db.select({
      id: webhookQueue.id,
      url: webhookQueue.url,
      status: webhookQueue.status,
      attempt: webhookQueue.attempt,
      responseStatus: webhookQueue.responseStatus,
      deliveredAt: webhookQueue.deliveredAt,
      createdAt: webhookQueue.createdAt,
      errorMessage: webhookQueue.errorMessage,
      payload: webhookQueue.payload,
    })
      .from(webhookQueue)
      .where(and(...conditions))
      .orderBy(desc(webhookQueue.createdAt))
      .limit(limit)
      .offset(offset);

    // Extract event type from payload
    const data = logs.map(log => ({
      id: log.id,
      url: log.url,
      status: log.status,
      attempt: log.attempt,
      responseStatus: log.responseStatus,
      deliveredAt: log.deliveredAt,
      createdAt: log.createdAt,
      errorMessage: log.errorMessage,
      eventType: (log.payload as Record<string, unknown>)?.['event'] || null,
    }));

    return NextResponse.json({
      data,
      total: countResult?.count ?? 0,
      page,
      limit,
    });
  } catch (err: unknown) { return apiError(err); }
}
