import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'stats-pipeline', 300, async () => {
    const [result] = await db
      .select({
        total: sql<number>`COALESCE(SUM(amount), 0)::float`,
        openDealsCount: sql<number>`COUNT(*)::int`,
      })
      .from(deals)
      .where(and(eq(deals.tenantId, tid), isNull(deals.deletedAt)));

    return NextResponse.json({
      data: {
        total: Number(result?.total ?? 0),
        openDealsCount: Number(result?.openDealsCount ?? 0),
      },
    });
  });
}
