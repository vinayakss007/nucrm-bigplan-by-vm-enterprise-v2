/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
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
            // #3112 — the tile promises revenue *won* this month. `created_at`
            // answered "created this month and won by now", which drops every
            // deal booked last month and closed this month — the majority of a
            // mature pipeline. `won_at` (0084, backfilled from
            // metadata.won_at) is the win date, and is written by
            // `deals/[id]` PATCH and, since this fix, by the bulk stage/close
            // actions. It is still NULL for wins recorded by the v1 `PUT`, the
            // inbound webhook and the automations (#3112 lists them), so the
            // fallback keeps those in the month they were created: a provable
            // lower bound on the win date, so this can only ever recover rows
            // the old predicate missed, never lose one it counted.
            sql`COALESCE(${deals.wonAt}, ${deals.createdAt}) >= date_trunc('month', now())`,
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
