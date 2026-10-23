/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals } from '@/drizzle/schema';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { resolveWonStageIds } from '@/lib/deals/won-stage-ids';
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
      // #3120 — this lookup used `lower(deal_stages.name) = 'won'` plus
      // `.limit(1)`, and both were wrong: the exact comparison resolved nothing
      // for a tenant whose winning stage is named `Closed Won`/`Deal Won` (the
      // vocabulary #658 settled for the rest of the app), and the cap made a
      // multi-pipeline workspace count whichever `Won` row Postgres happened to
      // return first. The ids now come from `isWonStageName`, with no cap, and
      // are compared with `inArray` — which renders the literal `false` for an
      // empty list, so a tenant with no winning stage answers 0 rather than
      // answering "every stage is the win stage".
      const wonStageIds = await resolveWonStageIds(db, tid);

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
          inArray(deals.stageId, wonStageIds),
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

      return NextResponse.json({ data: { wonThisMonth: Number(revenue?.total ?? 0) } });
    }, ownerCacheKey(auth, 'deals.view_all'));
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/stats/revenue', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
