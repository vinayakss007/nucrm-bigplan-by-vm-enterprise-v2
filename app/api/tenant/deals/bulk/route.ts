/**
 * Bulk Deal Operations
 * POST /api/tenant/deals/bulk
 * Body: { action, deal_ids, payload? }
 * Actions: assign, stage, delete, close, transfer
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines, tenantMembers, segments, segmentMembers } from '@/drizzle/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';

const MAX_BULK = 500;

export async function POST(req: NextRequest) {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const { action, deal_ids, payload = {} } = body;

    if (!Array.isArray(deal_ids) || !deal_ids.length)
      return NextResponse.json({ error: 'deal_ids array required' }, { status: 400 });
    if (deal_ids.length > MAX_BULK)
      return NextResponse.json({ error: `Max ${MAX_BULK} deals per bulk operation` }, { status: 400 });

    // Validate IDs belong to this tenant
    const valid = await db
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          inArray(deals.id, deal_ids),
          eq(deals.tenantId, ctx.tenantId),
          sql`${deals.deletedAt} IS NULL`
        )
      );

    const validIds = valid.map(r => r.id);
    if (!validIds.length)
      return NextResponse.json({ error: 'No valid deals found' }, { status: 404 });

    let affected = 0;

    switch (action) {
      case 'assign':
      case 'transfer': {
        const deny = requirePerm(ctx, 'deals.assign');
        if (deny) return deny;
        const assignTo = payload.assigned_to as string | undefined;
        if (!assignTo) return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });

        // Verify assignee is a member of this tenant
        const [member] = await db
          .select({ userId: tenantMembers.userId })
          .from(tenantMembers)
          .where(
            and(
              eq(tenantMembers.userId, assignTo),
              eq(tenantMembers.tenantId, ctx.tenantId),
              eq(tenantMembers.status, 'active')
            )
          )
          .limit(1);
        if (!member) return NextResponse.json({ error: 'Assignee not found in this workspace' }, { status: 404 });

        const res = await db
          .update(deals)
          .set({
            assignedTo: assignTo,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'stage': {
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const stageId = payload.stage_id as string | undefined;
        if (!stageId) return NextResponse.json({ error: 'stage_id required' }, { status: 400 });

        // Verify stage belongs to a pipeline owned by this tenant
        const [stage] = await db
          .select({ id: dealStages.id })
          .from(dealStages)
          .innerJoin(pipelines, eq(dealStages.pipelineId, pipelines.id))
          .where(
            and(
              eq(dealStages.id, stageId),
              eq(pipelines.tenantId, ctx.tenantId)
            )
          )
          .limit(1);
        if (!stage) return NextResponse.json({ error: 'Stage not found in this workspace' }, { status: 404 });

        const res = await db
          .update(deals)
          .set({
            stageId: stageId,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'close': {
        // Move to a target stage AND record close_reason in metadata
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const stageId = payload.stage_id as string | undefined;
        const reason = (payload.reason as string | undefined)?.trim() || null;
        const outcome = payload.outcome as string | undefined; // 'won' | 'lost'
        if (!stageId) return NextResponse.json({ error: 'stage_id required' }, { status: 400 });

        const [stage] = await db
          .select({ id: dealStages.id })
          .from(dealStages)
          .innerJoin(pipelines, eq(dealStages.pipelineId, pipelines.id))
          .where(
            and(
              eq(dealStages.id, stageId),
              eq(pipelines.tenantId, ctx.tenantId)
            )
          )
          .limit(1);
        if (!stage) return NextResponse.json({ error: 'Stage not found in this workspace' }, { status: 404 });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const closePatch: Record<string, any> = {
          closed_at: new Date().toISOString(),
          close_reason: reason,
        };
        if (outcome) closePatch['outcome'] = outcome;

        const res = await db
          .update(deals)
          .set({
            stageId: stageId,
            closeDate: new Date(),
            metadata: sql`COALESCE(${deals.metadata}, '{}'::jsonb) || ${JSON.stringify(closePatch)}::jsonb`,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'delete': {
        const deny = requirePerm(ctx, 'deals.delete');
        if (deny) return deny;

        const res = await db
          .update(deals)
          .set({
            deletedAt: new Date(),
            deletedBy: ctx.userId,
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId),
              sql`${deals.deletedAt} IS NULL`
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'tag': {
        // Deals don't have a tags column; store under metadata.tags[]
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const tag = (payload.tag as string | undefined)?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });

        const res = await db
          .update(deals)
          .set({
            metadata: sql`
              jsonb_set(
                COALESCE(${deals.metadata}, '{}'::jsonb),
                '{tags}',
                COALESCE(${deals.metadata}->'tags', '[]'::jsonb) ||
                CASE
                  WHEN COALESCE(${deals.metadata}->'tags', '[]'::jsonb) @> ${JSON.stringify([tag])}::jsonb
                  THEN '[]'::jsonb
                  ELSE ${JSON.stringify([tag])}::jsonb
                END
              )
            `,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }

      case 'update_field': {
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const fieldKey = payload['field_key'] as string | undefined;
        const fieldValue = payload['field_value'];
        if (!fieldKey) return NextResponse.json({ error: 'field_key required' }, { status: 400 });
        
        const res = await db
          .update(deals)
          .set({
            metadata: sql`jsonb_set(COALESCE(${deals.metadata}, '{}'::jsonb), ${'{"' + fieldKey + '"}'}::text[], ${JSON.stringify(fieldValue)}::jsonb, true)`,
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId)
            )
          );
        
        affected = res.rowCount ?? 0;
        break;
      }

      case 'archive': {
        const deny = requirePerm(ctx, 'deals.delete');
        if (deny) return deny;
        const res = await db
          .update(deals)
          .set({
            deletedAt: new Date(),
            deletedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'restore': {
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const res = await db
          .update(deals)
          .set({
            deletedAt: null,
            deletedBy: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(deals.id, validIds),
              eq(deals.tenantId, ctx.tenantId)
            )
          );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'add_to_segment': {
        const segId = payload['segment_id'] as string | undefined;
        if (!segId) return NextResponse.json({ error: 'segment_id required' }, { status: 400 });
        const [seg] = await db.select({ id: segments.id }).from(segments)
          .where(and(eq(segments.id, segId), eq(segments.tenantId, ctx.tenantId)))
          .limit(1);
        if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
        const memberValues = validIds.map(entityId => ({ segmentId: segId, entityId, tenantId: ctx.tenantId }));
        const resSeg = await db.insert(segmentMembers).values(memberValues).onConflictDoNothing();
        affected = resSeg.rowCount ?? memberValues.length;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, entityType: 'deal',
      newData: { count: affected, deal_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[deals bulk POST]', err);
    await logError({ error: err, context: 'deals/bulk', tenantId: ctx?.tenantId });
    return apiError(err);
  }
}
