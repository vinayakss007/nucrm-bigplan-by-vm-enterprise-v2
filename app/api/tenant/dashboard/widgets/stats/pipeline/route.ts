/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals } from '@/drizzle/schema';
import { eq, and, isNull, sql, notInArray } from 'drizzle-orm';
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

    return withCache(tid, 'stats-pipeline', 300, async () => {
      // #3156 — this tile decided which deals are closed with
      // `LOWER(name) LIKE '%won%' OR LOWER(name) LIKE '%lost%'`, a substring rule
      // that sweeps the negations #658 explicitly refuses: a stage called `Not
      // Won`, `Unwon` or `Wonderful Prospect` made its deals terminal, so they
      // left open pipeline and the tile answered low on BOTH numbers. The ids now
      // come from the matcher every other read uses. An empty set is a real
      // answer here — drizzle renders `notInArray(col, [])` as the literal `true`,
      // so a tenant with no terminal stage excludes nothing, as it should.
      const { terminal: terminalStageIds } = await resolveDealStageIds(db, tid);

      const [result] = await db
        .select({
          total: sql<number>`COALESCE(SUM(amount), 0)::float`,
          openDealsCount: sql<number>`COUNT(*)::int`,
        })
        .from(deals)
        .where(and(
          eq(deals.tenantId, tid),
          isNull(deals.deletedAt),
          // #2684 — an archived deal still held pipeline value here.
          notArchived(),
          ownerScope(auth, 'deals.view_all', deals),  // #2688
          notInArray(deals.stageId, terminalStageIds)
        ));

      return NextResponse.json({
        data: {
          total: Number(result?.total ?? 0),
          openDealsCount: Number(result?.openDealsCount ?? 0),
        },
      });
    }, ownerCacheKey(auth, 'deals.view_all'));
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/stats/pipeline', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
