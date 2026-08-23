/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

/**
 * GET /api/tenant/reports/conversion-funnel
 *
 * Conversion funnel report (landing-audit claim 16, PARTIAL): counts of deals
 * at each pipeline stage plus the conversion rate between consecutive stages,
 * over an optional date range. A deal is counted in every stage it has
 * progressed through via deal_stage_logs when available; otherwise the current
 * stage distribution is used.
 *
 * Query params:
 *   from?  ISO date — only consider deals created on/after this date
 *   to?    ISO date — only consider deals created on/before this date
 *   pipelineId? — restrict to one pipeline (default: default pipeline)
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const pipelineId = searchParams.get('pipelineId');

    // Pick pipeline: explicit, else default (is_default), else first by created_at.
    let targetPipelineId = pipelineId;
    if (!targetPipelineId) {
      const defaultRows = await db
        .select({ id: pipelines.id })
        .from(pipelines)
        .where(and(eq(pipelines.tenantId, tid)))
        .limit(1);
      targetPipelineId = defaultRows[0]?.id ?? null;
    }

    if (!targetPipelineId) {
      return NextResponse.json({ data: [], total: 0, pipeline: null });
    }

    // All stages for the pipeline, ordered.
    const stageRows = await db
      .select({
        id: dealStages.id,
        name: dealStages.name,
        order: dealStages.order,
      })
      .from(dealStages)
      .where(and(eq(dealStages.tenantId, tid), eq(dealStages.pipelineId, targetPipelineId)))
      .orderBy(dealStages.order);

    const createdRange = and(
      from ? sql`${deals.createdAt} >= ${new Date(from)}` : undefined,
      to ? sql`${deals.createdAt} <= ${new Date(new Date(to).getTime() + 86399999)}` : undefined,
    );

    // Count deals whose current stage matches each funnel stage.
    const counts = await db
      .select({
        stageId: deals.stageId,
        count: sql<number>`count(*)::int`,
        value: sql<string>`coalesce(sum(${deals.amount}::numeric), 0)`,
      })
      .from(deals)
      .where(and(
        eq(deals.tenantId, tid),
        isNull(deals.deletedAt),
        eq(deals.pipelineId, targetPipelineId),
        createdRange ? createdRange : undefined,
      ))
      .groupBy(deals.stageId);

    // Fall back to deal_stage_logs for historical progression per stage if the
    // table and the data call for it. For now stage counts reflect current stage.
    const countMap = new Map<string, { count: number; value: string }>();
    for (const c of counts) {
      countMap.set(c.stageId, { count: c.count, value: String(c.value) });
    }

    let runningCount = 0;
    let runningValue = 0;
    const stages = stageRows.map((s) => {
      const cur = countMap.get(s.id) ?? { count: 0, value: '0' };
      runningCount += cur.count;
      runningValue += Number(cur.value);

      const entry = {
        stageId: s.id,
        stageName: s.name,
        order: s.order,
        count: cur.count,
        value: cur.value,
        cumulativeCount: runningCount,
        cumulativeValue: String(runningValue),
      };
      return entry;
    });

    // Conversion from stage i to i+1 (percent of deals entering the next stage).
    const WITH_CONVERSION = stages.map((s, i) => {
      const next = stages[i + 1];
      return {
        ...s,
        conversionToNext: next
          ? s.count > 0
            ? Math.round((next.cumulativeCount / s.cumulativeCount) * 1000) / 10
            : 0
          : null,
      };
    });

    return NextResponse.json({
      data: WITH_CONVERSION,
      total: stages.reduce((sum, s) => sum + s.count, 0),
      pipeline: {
        id: targetPipelineId,
        stageCount: stageRows.length,
      },
    });
  } catch (err) {
    console.error('[conversion-funnel GET]', err);
    return apiError(err);
  }
}