/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, gte, sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';
import { logError, tenantMeta } from '@/lib/errors-server';

export async function GET(request: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    return withCache(tid, 'stats-revenue', 300, async () => {
      const [wonStage] = await db
        .select({ id: dealStages.id })
        .from(dealStages)
        .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
        .where(and(eq(pipelines.tenantId, tid), sql`lower(${dealStages.name}) = 'won'`))
        .limit(1);

      let wonThisMonth = 0;
      if (wonStage) {
        const [revenue] = await db
          .select({
            total: sql<number>`COALESCE(SUM(amount), 0)::float`,
          })
          .from(deals)
          .where(and(
            eq(deals.tenantId, tid),
            isNull(deals.deletedAt),
            eq(deals.stageId, wonStage.id),
            gte(deals.createdAt, sql`date_trunc('month', now())`),
          ));
        wonThisMonth = Number(revenue?.total ?? 0);
      }

      return NextResponse.json({ data: { wonThisMonth } });
    });
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/stats/revenue', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
}
