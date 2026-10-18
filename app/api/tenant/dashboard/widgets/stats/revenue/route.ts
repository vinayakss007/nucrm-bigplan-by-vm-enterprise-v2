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
import { ownerScope, ownerCacheKey } from '@/lib/api/owner-scope';
import { notArchived } from '@/lib/api/deals-archive-filter';
import { logError, tenantMeta } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    // `ctx` is a `let`, so the narrowing the guard above establishes does not
    // survive into the withCache closure (#2688).
    const auth = ctx;

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
            // #2695 — the tile totalled the workspace for a rep whose pipeline
            // tile beside it (`widgets/stats/pipeline/route.ts:49`) shows only
            // their own, and it counted archived deals, which #2684 hid from
            // every other deals read. `and()` skips the `undefined` a
            // `deals.view_all` holder gets, so their SQL is unchanged.
            notArchived(),
            ownerScope(auth, 'deals.view_all', deals),
            eq(deals.stageId, wonStage.id),
            gte(deals.createdAt, sql`date_trunc('month', now())`),
          ));
        wonThisMonth = Number(revenue?.total ?? 0);
      }

      return NextResponse.json({ data: { wonThisMonth } });
    }, ownerCacheKey(auth, 'deals.view_all'));
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/stats/revenue', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
