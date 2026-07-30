import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * GET /api/tenant/reports/win-loss
 * Win/loss analysis — why deals are won or lost.
 *
 * Returns:
 * - win_rate: overall percentage
 * - avg_won_deal_value vs avg_lost_deal_value
 * - avg_days_to_win vs avg_days_to_lose
 * - top_loss_reasons (from metadata.loss_reason if tracked)
 * - monthly_trend (won vs lost per month, last 6 months)
 * - by_source: win rate per lead source
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const tid = ctx.tenantId;

    // Overall win/loss stats
    const stats = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ds.name ILIKE '%won%') as won,
        COUNT(*) FILTER (WHERE ds.name ILIKE '%lost%') as lost,
        COUNT(*) as total_closed,
        COALESCE(AVG(d.amount::numeric) FILTER (WHERE ds.name ILIKE '%won%'), 0)::numeric(12,2) as avg_won_value,
        COALESCE(AVG(d.amount::numeric) FILTER (WHERE ds.name ILIKE '%lost%'), 0)::numeric(12,2) as avg_lost_value,
        COALESCE(AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at))/86400) FILTER (WHERE ds.name ILIKE '%won%'), 0)::numeric(10,1) as avg_days_to_win,
        COALESCE(AVG(EXTRACT(EPOCH FROM (d.updated_at - d.created_at))/86400) FILTER (WHERE ds.name ILIKE '%lost%'), 0)::numeric(10,1) as avg_days_to_lose
      FROM deals d
      LEFT JOIN deal_stages ds ON ds.id = d.stage_id
      WHERE d.tenant_id = ${tid}
        AND d.deleted_at IS NULL
        AND ds.name ILIKE ANY(ARRAY['%won%', '%lost%'])
    `);

    // Monthly trend (last 6 months)
    const monthlyTrend = await db.execute(sql`
      SELECT
        TO_CHAR(d.updated_at, 'YYYY-MM') as month,
        COUNT(*) FILTER (WHERE ds.name ILIKE '%won%') as won,
        COUNT(*) FILTER (WHERE ds.name ILIKE '%lost%') as lost
      FROM deals d
      LEFT JOIN deal_stages ds ON ds.id = d.stage_id
      WHERE d.tenant_id = ${tid}
        AND d.deleted_at IS NULL
        AND ds.name ILIKE ANY(ARRAY['%won%', '%lost%'])
        AND d.updated_at >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(d.updated_at, 'YYYY-MM')
      ORDER BY month DESC
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = stats.rows[0] as any;
    const won = Number(s?.won ?? 0);
    const lost = Number(s?.lost ?? 0);
    const totalClosed = won + lost;

    return NextResponse.json({
      data: {
        win_rate: totalClosed > 0 ? Math.round((won / totalClosed) * 100) : 0,
        won_deals: won,
        lost_deals: lost,
        total_closed: totalClosed,
        avg_won_value: Number(s?.avg_won_value ?? 0),
        avg_lost_value: Number(s?.avg_lost_value ?? 0),
        avg_days_to_win: Number(s?.avg_days_to_win ?? 0),
        avg_days_to_lose: Number(s?.avg_days_to_lose ?? 0),
        monthly_trend: (monthlyTrend.rows as Array<{ month: string; won: number; lost: number }>).map(r => ({
          month: r.month,
          won: Number(r.won),
          lost: Number(r.lost),
        })),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
