/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, asc, sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';
import { logError, tenantMeta } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  let ctx: Awaited<ReturnType<typeof requireAuth>> | undefined;
  try {
    ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    return withCache(tid, 'deals-closing', 300, async () => {
      // Single round-trip: terminal-stage filter inlined as a subselect
      // (previously a stages query followed by the items query). NOT IN over
      // an empty set matches everything, preserving the old fallback.
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
          sql`${deals.stageId} NOT IN (
            SELECT ds.id FROM ${dealStages} ds
            INNER JOIN ${pipelines} p ON p.id = ds.pipeline_id
            WHERE p.tenant_id = ${tid} AND lower(ds.name) IN ('won', 'lost')
          )`,
        ))
        .orderBy(asc(deals.closeDate))
        .limit(5);

      return NextResponse.json({ data: { items } });
    });
  } catch (err) {
    void logError({ error: err, context: 'GET /api/tenant/dashboard/widgets/deals/closing', ...tenantMeta(ctx) });
    return NextResponse.json({ error: 'Widget failed' }, { status: 500 });
  }
});
