import { NextRequest, NextResponse } from 'next/server';
import { requireTenantCtx } from '@/lib/tenant/context';
import { db } from '@/drizzle/db';
import { contacts, deals, tasks, pipelines, dealStages } from '@/drizzle/schema';
import { eq, and, sql, asc, desc, inArray } from 'drizzle-orm';

export async function GET(_request: NextRequest) {
  try {
    const ctx = await requireTenantCtx();
    if (ctx instanceof NextResponse) return ctx;

    const [contactsResult, dealsResult, tasksResult, pipesResult] = await Promise.all([
      db.select({
        id: contacts.id,
        leadSource: contacts.leadSource,
        leadStatus: contacts.leadStatus,
        createdAt: contacts.createdAt,
      })
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), sql`${contacts.deletedAt} IS NULL`))
        .limit(500),

      db.select({
        id: deals.id,
        stageId: deals.stageId,
        amount: deals.amount,
        createdAt: deals.createdAt,
      })
        .from(deals)
        .where(and(eq(deals.tenantId, ctx.tenantId), sql`${deals.deletedAt} IS NULL`))
        .limit(500),

      db.select({
        id: tasks.id,
        completed: tasks.completed,
        dueDate: tasks.dueDate,
        createdAt: tasks.createdAt,
      })
        .from(tasks)
        .where(and(eq(tasks.tenantId, ctx.tenantId), sql`${tasks.deletedAt} IS NULL`))
        .limit(500),

      db.select({
        id: pipelines.id,
        name: pipelines.name,
      })
        .from(pipelines)
        .where(eq(pipelines.tenantId, ctx.tenantId))
        .orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt)),
    ]);

    const pipelineIds = pipesResult.map(p => p.id);
    const allStages = pipelineIds.length > 0
      ? await db.select({ id: dealStages.id, name: dealStages.name, pipelineId: dealStages.pipelineId })
          .from(dealStages)
          .where(inArray(dealStages.pipelineId, pipelineIds))
          .orderBy(asc(dealStages.order))
      : [];

    const stagesByPipeline = new Map<string, typeof allStages>();
    for (const s of allStages) {
      const list = stagesByPipeline.get(s.pipelineId);
      if (list) list.push(s);
      else stagesByPipeline.set(s.pipelineId, [s]);
    }

    return NextResponse.json({
      data: {
        contacts: contactsResult,
        deals: dealsResult,
        tasks: tasksResult,
        pipelines: pipesResult.map(p => ({
          ...p,
          stages: stagesByPipeline.get(p.id) ?? [],
        })),
      },
    });
  } catch (error) {
    console.error('[analytics/overview/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch analytics data' }, { status: 500 });
  }
}
