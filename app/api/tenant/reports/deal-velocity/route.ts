import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';

/**
 * GET /api/tenant/reports/deal-velocity
 * Deal pipeline velocity metrics — how fast deals move through stages.
 *
 * Returns:
 * - avg_days_to_close: average days from creation to won
 * - avg_days_per_stage: average time spent in each stage
 * - conversion_rate: % of deals that reach "won"
 * - stage_distribution: current deal count per stage
 * - total_pipeline_value: sum of all active deal amounts
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const tid = ctx.tenantId;

    // Avg days to close (won deals only)
    const avgCloseResult = await db.execute(sql`
      SELECT 
        COALESCE(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400), 0)::numeric(10,1) as avg_days
      FROM deals
      WHERE tenant_id = ${tid}
        AND deleted_at IS NULL
        AND stage_id IN (SELECT id FROM deal_stages WHERE LOWER(name) IN ('won', 'closed won'))
    `);

    // Conversion rate (won / total created)
    const countsResult = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE stage_id IN (SELECT id FROM deal_stages WHERE LOWER(name) IN ('won', 'closed won'))) as won,
        COUNT(*) as total
      FROM deals
      WHERE tenant_id = ${tid} AND deleted_at IS NULL
    `);

    // Stage distribution
    const stageDistribution = await db
      .select({
        stageId: deals.stageId,
        stageName: dealStages.name,
        count: sql<number>`count(*)::int`,
        totalValue: sql<number>`COALESCE(SUM(${deals.amount}::numeric), 0)::numeric(12,2)`,
      })
      .from(deals)
      .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
      .where(and(eq(deals.tenantId, tid), isNull(deals.deletedAt)))
      .groupBy(deals.stageId, dealStages.name);

    // Total pipeline value (active deals)
    const pipelineValueResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount::numeric), 0)::numeric(12,2) as total
      FROM deals
      WHERE tenant_id = ${tid}
        AND deleted_at IS NULL
        AND stage_id NOT IN (SELECT id FROM deal_stages WHERE LOWER(name) IN ('won', 'closed won', 'lost', 'closed lost'))
    `);

    // Deals created this month
    const monthlyCreatedResult = await db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM deals
      WHERE tenant_id = ${tid}
        AND deleted_at IS NULL
        AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countsRow = countsResult.rows[0] as any;
    const wonCount = Number(countsRow?.won ?? 0);
    const totalCount = Number(countsRow?.total ?? 1);

    return NextResponse.json({
      data: {
        avg_days_to_close: Number((avgCloseResult.rows[0] as { avg_days: string })?.avg_days ?? 0),
        conversion_rate: totalCount > 0 ? Math.round((wonCount / totalCount) * 100) : 0,
        total_pipeline_value: Number((pipelineValueResult.rows[0] as { total: string })?.total ?? 0),
        deals_this_month: Number((monthlyCreatedResult.rows[0] as { count: number })?.count ?? 0),
        won_deals: wonCount,
        total_deals: totalCount,
        stage_distribution: stageDistribution.map(s => ({
          stage: s.stageName || 'Unknown',
          count: s.count,
          value: Number(s.totalValue),
        })),
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
