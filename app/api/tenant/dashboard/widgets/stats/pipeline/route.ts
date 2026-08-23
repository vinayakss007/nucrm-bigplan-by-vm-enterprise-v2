/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages } from '@/drizzle/schema';
import { eq, and, isNull, sql, notInArray } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    return withCache(tid, 'stats-pipeline', 300, async () => {
      // Subquery to get terminal stage IDs (won/lost) scoped to this tenant
      const terminalStageIds = db
        .select({ id: dealStages.id })
        .from(dealStages)
        .where(and(
          eq(dealStages.tenantId, tid),
          sql`(LOWER(${dealStages.name}) LIKE '%won%' OR LOWER(${dealStages.name}) LIKE '%lost%')`
        ));

      const [result] = await db
        .select({
          total: sql<number>`COALESCE(SUM(amount), 0)::float`,
          openDealsCount: sql<number>`COUNT(*)::int`,
        })
        .from(deals)
        .where(and(
          eq(deals.tenantId, tid),
          isNull(deals.deletedAt),
          notInArray(deals.stageId, terminalStageIds)
        ));

      return NextResponse.json({
        data: {
          total: Number(result?.total ?? 0),
          openDealsCount: Number(result?.openDealsCount ?? 0),
        },
      });
    });
  } catch (err) {
    console.error('[widget:stats-pipeline] failed:', err);
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
}
