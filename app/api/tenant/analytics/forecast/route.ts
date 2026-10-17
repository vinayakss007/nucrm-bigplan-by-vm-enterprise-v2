/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { dealForecasts } from '@/drizzle/schema';
import { revenueForecastSummary } from '@/drizzle/schema';
import { deals } from '@/drizzle/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import { z } from 'zod';
import { readJsonBody, validateBody, uuidField } from '@/lib/api/validate';
import { ownerScope } from '@/lib/api/owner-scope';
import { withApiRoute } from '@/lib/api/with-api-route';
import { rateLimitRead } from '@/lib/api/read-rate-limit';

const calculateSchema = z.object({ deal_id: uuidField });

/**
 * GET /api/tenant/analytics/forecast
 * Get deal forecasts and revenue projections
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitRead(request, 'analytics');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const [forecastsResult, [summary]] = await Promise.all([
      db.execute(sql`SELECT * FROM public.deals_by_win_probability WHERE tenant_id = ${ctx.tenantId} LIMIT 100`),
      db.select()
        .from(revenueForecastSummary)
        .where(eq(revenueForecastSummary.tenantId, ctx.tenantId))
        .orderBy(desc(revenueForecastSummary.forecastDate))
        .limit(1)
    ]);

    return NextResponse.json({
      data: forecastsResult.rows,
      summary: summary || {},
    });
 
 
  } catch (error) {
    void logError({ error, context: 'tenant/analytics/forecast GET' });
    return apiError(error);
  }
});

/**
 * POST /api/tenant/analytics/forecast
 * Calculate win probability for a deal.
 *
 * The comment here used to advertise `.../forecast/calculate`; no such route
 * exists under `app/api/tenant/analytics/`, and #2556 found it by following the
 * comment rather than the tree.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'deals.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(calculateSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { deal_id } = validated.data;

    // #2524 — deal_id arrives from the body, so it is only ever as trusted as
    // the tenant gate below. Both the RPC and the forecast read must be proven
    // in-tenant first: RLS is this repo's backstop, never its primary filter.
    // #2777 — and proven *owned*. `deals.edit` is the only gate here, and
    // `sales_rep` holds it with `deals.view_all` false
    // (`lib/permissions/definitions.ts:135`), so tenant + tombstone alone let a
    // rep score a colleague's deal and read back its `deal_forecasts` row — the
    // same row `deals/[id]/forecast/route.ts:31-43` has refused them since #2709.
    const [ownedDeal] = await db
      .select({ id: deals.id })
      .from(deals)
      .where(and(
        eq(deals.id, deal_id),
        eq(deals.tenantId, ctx.tenantId),
        sql`${deals.deletedAt} IS NULL`,
        ownerScope(ctx, 'deals.view_all', deals),
      ))
      .limit(1);
    if (!ownedDeal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const result = await db.execute(sql`SELECT public.calculate_deal_win_probability(${deal_id}) as probability`);
    const probability = (result.rows[0] as Record<string, unknown>)?.probability as number || 0;

    const [forecast] = await db.select()
      .from(dealForecasts)
      .where(and(eq(dealForecasts.dealId, deal_id), eq(dealForecasts.tenantId, ctx.tenantId)))
      .limit(1);

    return NextResponse.json({
      ok: true,
      probability,
      forecast,
    });
 
 
  } catch (error) {
    void logError({ error, context: 'tenant/analytics/forecast calculate POST' });
    return apiError(error);
  }
});
