import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { pipelines, dealStages } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    
    const result = await db.transaction(async (tx) => {
      // 1. Update pipeline basic info
      const updateData: any = { updatedAt: new Date() };
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      
      let pipelineRow;
      if (Object.keys(updateData).length > 1) {
        [pipelineRow] = await tx.update(pipelines)
          .set(updateData)
          .where(and(eq(pipelines.id, id), eq(pipelines.tenantId, ctx.tenantId)))
          .returning();
      } else {
        pipelineRow = await tx.query.pipelines.findFirst({
          where: and(eq(pipelines.id, id), eq(pipelines.tenantId, ctx.tenantId))
        });
      }

      if (!pipelineRow) return null;

      // 2. Handle stages update if provided
      if (body.stages !== undefined && Array.isArray(body.stages)) {
        // Delete existing stages
        await tx.delete(dealStages).where(eq(dealStages.pipelineId, id));
        
        // Insert new stages
        if (body.stages.length > 0) {
          const stagesToCreate = body.stages.map((s: any, idx: number) => ({
            tenantId: ctx.tenantId,
            pipelineId: id,
            name: s.name || s.label || s.id,
            order: s.order ?? idx
          }));
          await tx.insert(dealStages).values(stagesToCreate);
        }
      }

      return pipelineRow;
    });

    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: result });
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;

    const pipeline = await db.query.pipelines.findFirst({
      where: and(eq(pipelines.id, id), eq(pipelines.tenantId, ctx.tenantId)),
      columns: { isDefault: true }
    });

    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (pipeline.isDefault) return NextResponse.json({ error: 'Cannot delete the default pipeline' }, { status: 400 });

    await db.delete(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.tenantId, ctx.tenantId)));
    
    return NextResponse.json({ ok: true });
  } catch (err: any) { 
    return apiError(err); 
  }
}
