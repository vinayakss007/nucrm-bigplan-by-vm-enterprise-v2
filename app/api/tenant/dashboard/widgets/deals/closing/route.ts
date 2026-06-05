import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, isNull, notInArray, asc, sql } from 'drizzle-orm';
import { withCache } from '@/lib/dashboard/widget-cache';

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenantId;

  return withCache(tid, 'deals-closing', 300, async () => {
    const terminalStages = await db
      .select({ id: dealStages.id })
      .from(dealStages)
      .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
      .where(and(eq(pipelines.tenantId, tid), sql`lower(${dealStages.name}) IN ('won', 'lost')`));

    const terminalIds = terminalStages.map(s => s.id);

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
        ...(terminalIds.length > 0 ? [notInArray(deals.stageId, terminalIds)] : []),
      ))
      .orderBy(asc(deals.closeDate))
      .limit(5);

    return NextResponse.json({ data: { items } });
  });
}
