import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { dealForecasts } from '@/drizzle/schema';
import { revenueForecastSummary } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * GET /api/tenant/analytics/forecast
 * Get deal forecasts and revenue projections
 */
export async function GET(request: NextRequest) {
  try {
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
  } catch (error: any) {
    console.error('[Forecast Analytics] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/analytics/forecast/calculate
 * Calculate win probability for a deal
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'deals.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { deal_id } = body;

    if (!deal_id) {
      return NextResponse.json({ error: 'deal_id is required' }, { status: 400 });
    }

    const result = await db.execute(sql`SELECT public.calculate_deal_win_probability(${deal_id}) as probability`);
    const probability = (result.rows[0] as any)?.probability || 0;

    const [forecast] = await db.select()
      .from(dealForecasts)
      .where(eq(dealForecasts.dealId, deal_id))
      .limit(1);

    return NextResponse.json({
      ok: true,
      probability,
      forecast,
    });
  } catch (error: any) {
    console.error('[Forecast Calculate] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
