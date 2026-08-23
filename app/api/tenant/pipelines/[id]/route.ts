/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updatePipelineSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { pipelines, dealStages, deals } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

/**
 * Raised inside the PATCH transaction when a requested stage removal would
 * orphan deals. Thrown rather than returned so the surrounding transaction
 * rolls back the renames/inserts already applied in the same request.
 */
class StageInUseError extends Error {
  constructor(public readonly stageNames: string[]) {
    super('stages still hold deals');
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function PATCH(req: NextRequest, { params }: any) {
  try {
  const limited = await rateLimitMutating(req, 'deals', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;
    const body = await readJsonBody(req);
    const validated = validateBody(updatePipelineSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, pipelines, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;
    
    const result = await db.transaction(async (tx) => {
      // Acquire row-level lock on the pipeline to prevent concurrent stage reorders
      try {
        await tx.execute(sql`SELECT 1 FROM pipelines WHERE id = ${id} FOR UPDATE`);
      } catch {
        // Lock acquisition failed (e.g., row doesn't exist yet) - proceed with optimistic concurrency
      }

      // 1. Update pipeline basic info
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = { updatedAt: new Date() };
      if (v.name !== undefined) updateData.name = v.name;
      if (v.description !== undefined) updateData.description = v.description;
      if (v.is_active !== undefined) updateData.isActive = v.is_active;
      
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

      // 2. Handle stages update if provided.
      //
      // This reconciles against the existing rows instead of replacing them.
      // The previous implementation deleted every stage in the pipeline and
      // re-inserted, which cannot work on a pipeline that is actually in use:
      // deals.stage_id is NOT NULL and references deal_stages with
      // ON DELETE no action, so the DELETE aborts the transaction with a foreign
      // key violation. Renaming or reordering a single stage returned a 500.
      //
      // Reconciling also preserves stage ids, so deals stay in the stage the
      // user was looking at rather than being silently repointed.
      if (body.stages !== undefined && Array.isArray(body.stages)) {
        const incoming = body.stages as Array<{
          id?: string;
          name?: string;
          label?: string;
          order?: number;
        }>;

        const existing = await tx
          .select({ id: dealStages.id, name: dealStages.name })
          .from(dealStages)
          .where(eq(dealStages.pipelineId, id));
        const existingById = new Map(existing.map((s) => [s.id, s]));

        const keptIds = new Set<string>();
        for (const s of incoming) {
          if (s.id && existingById.has(s.id)) keptIds.add(s.id);
        }

        // Refuse before mutating anything if a removal would orphan deals.
        // Soft-deleted deals count: the FK constraint does not consider
        // deleted_at, so they block the delete just the same.
        const removed = existing.filter((s) => !keptIds.has(s.id));
        if (removed.length > 0) {
          const blocking = await tx
            .select({ stageId: deals.stageId, count: sql<number>`count(*)::int` })
            .from(deals)
            .where(inArray(deals.stageId, removed.map((s) => s.id)))
            .groupBy(deals.stageId);

          if (blocking.length > 0) {
            const blockedIds = new Set(blocking.map((b) => b.stageId));
            throw new StageInUseError(
              removed.filter((s) => blockedIds.has(s.id)).map((s) => s.name)
            );
          }
        }

        for (const [idx, s] of incoming.entries()) {
          const requestedName = String(s.name ?? s.label ?? '').trim();
          const order = s.order ?? idx;

          if (s.id && existingById.has(s.id)) {
            await tx
              .update(dealStages)
              .set({
                // Fall back to the stored name so a payload that omits `name`
                // reorders without blanking the stage.
                name: requestedName || existingById.get(s.id)!.name,
                order,
                updatedAt: new Date(),
              })
              .where(and(eq(dealStages.id, s.id), eq(dealStages.pipelineId, id)));
          } else if (requestedName) {
            await tx.insert(dealStages).values({
              tenantId: ctx.tenantId,
              pipelineId: id,
              name: requestedName,
              order,
            });
          }
        }

        if (removed.length > 0) {
          await tx
            .delete(dealStages)
            .where(inArray(dealStages.id, removed.map((s) => s.id)));
        }
      }

      return pipelineRow;
    });

    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: result });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    if (err instanceof StageInUseError) {
      // 409, not 500: the request is understood and the data is intact, the
      // caller just has to move the deals first.
      return NextResponse.json(
        {
          error:
            `Cannot remove stage${err.stageNames.length > 1 ? 's' : ''} that still ` +
            `hold deals: ${err.stageNames.join(', ')}. Move those deals to another ` +
            `stage first.`,
          stages: err.stageNames,
        },
        { status: 409 }
      );
    }
    return apiError(err); 
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(req: NextRequest, { params }: any) {
  try {
  const limited = await rateLimitMutating(req, 'deals', 'delete');
  if (limited) return limited;
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

    // Deleting a pipeline cascades to its deal_stages, but deals.stage_id is
    // NOT NULL with ON DELETE no action, so that cascade fails with a foreign
    // key violation whenever the pipeline still has deals. Guarding here turns
    // an opaque 500 into an actionable 409.
    //
    // Counted without a deleted_at filter on purpose: the constraint does not
    // care that a deal is soft-deleted, so soft-deleted deals block the delete
    // too. This is why the dealCount in GET /pipelines (which filters
    // deleted_at IS NULL) is not a safe basis for this check.
    const stageIds = (
      await db
        .select({ id: dealStages.id })
        .from(dealStages)
        .where(eq(dealStages.pipelineId, id))
    ).map((s) => s.id);

    if (stageIds.length > 0) {
      const [blocking] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(deals)
        .where(inArray(deals.stageId, stageIds));

      const dealCount = blocking?.count ?? 0;
      if (dealCount > 0) {
        return NextResponse.json(
          {
            error:
              `Cannot delete a pipeline that still has ${dealCount} deal` +
              `${dealCount === 1 ? '' : 's'} (including archived ones). Move them ` +
              `to another pipeline first.`,
            dealCount,
          },
          { status: 409 }
        );
      }
    }

    await db.update(pipelines).set({ deletedAt: new Date() }).where(and(eq(pipelines.id, id), eq(pipelines.tenantId, ctx.tenantId)));
    
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}
