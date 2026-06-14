import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { createPipelineSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { pipelines, dealStages, deals } from '@/drizzle/schema';
import { eq, asc, desc, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const pipelineList = await db.select({
      id: pipelines.id,
      name: pipelines.name,
      description: pipelines.description,
      isDefault: pipelines.isDefault,
      createdAt: pipelines.createdAt,
      dealCount: sql<number>`(SELECT count(*)::int FROM ${deals} WHERE ${deals.pipelineId} = ${pipelines.id} AND ${deals.deletedAt} IS NULL)`
    })
    .from(pipelines)
    .where(eq(pipelines.tenantId, ctx.tenantId))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt));

    // Get stages for each pipeline
    const pipelinesWithStages = await Promise.all(pipelineList.map(async (pipeline) => {
      const stages = await db.query.dealStages.findMany({
        limit: 200,
        where: eq(dealStages.pipelineId, pipeline.id),
        orderBy: [asc(dealStages.order)]
      });
      return { ...pipeline, stages };
    }));

    return NextResponse.json({ data: pipelinesWithStages });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const validated = validateBody(createPipelineSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const name = v.name;
    const stages = body.stages;

    const defaultStages = [
      { name: 'Lead',        order: 0 },
      { name: 'Qualified',   order: 1 },
      { name: 'Proposal',    order: 2 },
      { name: 'Negotiation', order: 3 },
      { name: 'Won',         order: 4 },
      { name: 'Lost',        order: 5 },
    ];

    const result = await db.transaction(async (tx) => {
      const [newPipeline] = await tx.insert(pipelines)
        .values({
          tenantId: ctx.tenantId,
          name: name.trim(),
          isDefault: false
        })
        .returning();

      if (!newPipeline) throw new Error('Failed to create pipeline');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stagesToCreate = (stages || defaultStages).map((s: any, idx: number) => ({
        tenantId: ctx.tenantId,
        pipelineId: newPipeline.id,
        name: s.name || s.label || s.id,
        order: s.order ?? idx
      }));

      const createdStages = await tx.insert(dealStages)
        .values(stagesToCreate)
        .returning();

      return { ...newPipeline, stages: createdStages };
    });

    return NextResponse.json({ data: result }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
