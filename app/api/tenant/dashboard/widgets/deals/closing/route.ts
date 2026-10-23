/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages } from '@/drizzle/schema';
import { eq, and, isNull, asc, notInArray } from 'drizzle-orm';
import { resolveDealStageIds } from '@/lib/deals/won-stage-ids';
import { notArchived } from '@/lib/api/deals-archive-filter';
import { ownerScope, ownerCacheKey } from '@/lib/api/owner-scope';
import { withCache } from '@/lib/dashboard/widget-cache';
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

    return withCache(tid, 'deals-closing', 300, async () => {
      // #3156 — the exclusion was `lower(ds.name) IN ('won', 'lost')`, an exact
      // match on two labels, so a tenant whose winning stage is `Closed Won` (the
      // vocabulary #658 settled) never had its won deals excluded and this widget
      // kept listing deals that closed months ago. One resolved set now, and the
      // empty case keeps the behaviour that subselect had for the wrong reason:
      // `notInArray(col, [])` renders the literal `true`, so a tenant with no
      // terminal stage excludes nothing.
      const { terminal: terminalStageIds } = await resolveDealStageIds(db, tid);

      const items = await db
        .select({
          id: deals.id,
          title: deals.title,
          value: deals.amount,
          stage: dealStages.name,
          closeDate: deals.closeDate,
        })
        .from(deals)
        .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
        .where(and(
          eq(deals.tenantId, tid),
          isNull(deals.deletedAt),
          notArchived(),  // #2684
          ownerScope(auth, 'deals.view_all', deals),  // #2688
          notInArray(deals.stageId, terminalStageIds),
        ))
        .orderBy(asc(deals.closeDate))
        .limit(5);

      return NextResponse.json({ data: { items } });
    }, ownerCacheKey(auth, 'deals.view_all'));
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/deals/closing', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
