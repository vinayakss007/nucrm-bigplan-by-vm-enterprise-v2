/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Bulk Deal Operations
 * POST /api/tenant/deals/bulk
 * Body: { action, deal_ids?, payload?, selectAll?, filters? }
 * Actions: assign, stage, delete, close, transfer
 * When selectAll=true, deal_ids is optional; deals are resolved from filters.
 */
import { apiError } from '@/lib/api-error';
import { escapeLike } from '@/lib/api/sanitize-like';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { ownerScope } from '@/lib/api/owner-scope';
import { db } from '@/drizzle/db';
import { deals, dealStages, pipelines, tenantMembers, segments, segmentMembers, tenants, plans } from '@/drizzle/schema';
import { eq, and, inArray, sql, or, ilike, isNull } from 'drizzle-orm';
import { logAudit, bulkIdsAudit } from '@/lib/audit';
import { logError } from '@/lib/errors-server';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { enforceFieldWrite } from '@/lib/rbac/enforce';
import { wonAtPatch } from '@/lib/deals/won-stage';

const MAX_BULK = 500;

export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'bulk', 'post');
  if (limited) return limited;
  let ctx!: AuthContext;
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    ctx = auth;

    const body = await readJsonBody(req);
    const { action, payload = {} } = body;
    const selectAll = body.selectAll === true;
    const filters = body.filters as { q?: string; pipeline_id?: string; stage_id?: string; assigned_to?: string } | undefined;

    let deal_ids: string[] = body.deal_ids ?? [];

    // #2671 — into every id set this route writes, ahead of the caller's filters
    // (`and()` skips the undefined a `view_all` holder gets). See lib/api/owner-scope.ts.
    const mine = ownerScope(ctx, 'deals.view_all', deals);
    if (selectAll) {
      const whereConditions = [
        eq(deals.tenantId, ctx.tenantId),
        sql`${deals.deletedAt} IS NULL`,
      ];
      if (filters?.pipeline_id) whereConditions.push(eq(deals.pipelineId, filters.pipeline_id));
      if (filters?.stage_id) whereConditions.push(eq(deals.stageId, filters.stage_id));
      if (filters?.assigned_to) whereConditions.push(eq(deals.assignedTo, filters.assigned_to));
      if (filters?.q) {
        whereConditions.push(or(
          ilike(deals.title, `%${escapeLike(filters.q)}%`),
        )!);
      }
      const matched = await db.select({ id: deals.id }).from(deals).where(and(mine, ...whereConditions));
      deal_ids = matched.map(r => r.id);
      if (!deal_ids.length) return NextResponse.json({ error: 'No deals match the provided filters' }, { status: 404 });
      if (deal_ids.length > MAX_BULK) return NextResponse.json({ error: `Max ${MAX_BULK} deals per bulk operation (matched ${deal_ids.length})` }, { status: 400 });
    } else {
      if (!Array.isArray(deal_ids) || !deal_ids.length)
        return NextResponse.json({ error: 'deal_ids array required' }, { status: 400 });
      if (deal_ids.length > MAX_BULK)
        return NextResponse.json({ error: `Max ${MAX_BULK} deals per bulk operation` }, { status: 400 });
    }

    // Validate IDs belong to this tenant
    const valid = await db
      .select({ id: deals.id })
      .from(deals)
      .where(
        and(
          inArray(deals.id, deal_ids),
          eq(deals.tenantId, ctx.tenantId),
          sql`${deals.deletedAt} IS NULL`,
          mine
        )
      );

    const validIds = valid.map(r => r.id);
    // `restore` operates on soft-deleted rows, which the live-only validation
    // above (deletedAt IS NULL) never matches — it resolves its own set of
    // restorable ids, so don't bail out here for that action.
    if (!validIds.length && action !== 'restore')
      return NextResponse.json({ error: 'No valid deals found' }, { status: 404 });

    let affected = 0, auditIds: string[] = validIds; // #3220: the audit names what the action wrote, not the request

    // #2616 — assign/transfer/stage/close write real deals columns
    // (assigned_to / stage_id) straight from payload keys with no
    // enforceFieldWrite on the path, so a role with those fields hidden via
    // field_permissions could still bulk-move or bulk-assign deals. Unlike
    // PATCH, stripping the action's only payload value would leave the
    // action meaningless, so reject the whole request (403) instead.
    const BULK_WATCHED_FIELDS: Record<string, string[]> = {
      assign: ['assigned_to'],
      transfer: ['assigned_to'],
      stage: ['stage_id'],
      close: ['stage_id'],
    };
    const watched = BULK_WATCHED_FIELDS[action as string];
    if (watched) {
      const { stripped } = await enforceFieldWrite(
        ctx, 'deals', Object.fromEntries(watched.map((f) => [f, true])),
      );
      if (stripped.length > 0) {
        return NextResponse.json(
          { error: `field_permissions restricts: ${stripped.join(', ')}` },
          { status: 403 },
        );
      }
    }

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
          .select({ id: dealStages.id, name: dealStages.name })
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
            ...wonAtPatch(stage.name),
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
          .select({ id: dealStages.id, name: dealStages.name })
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

        // #3112 — the stage decides the win, not `payload.outcome`, which is the
        // caller's label; both now go through wonAtPatch, as PATCH does.
        const closePatch: Record<string, unknown> = {
          closed_at: new Date().toISOString(),
          close_reason: reason,
        };
        if (outcome) closePatch['outcome'] = outcome;

        const res = await db
          .update(deals)
          .set({
            stageId: stageId,
            closeDate: new Date(),
            ...wonAtPatch(stage.name),
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

        // Wrap the soft-delete + tenant-counter decrement so the two writes
        // succeed or fail together (H7). Without the tx a failed counter update
        // would leave currentDeals inflated after the rows are marked deleted.
        affected = await db.transaction(async (tx) => {
          const res = await tx
            .update(deals)
            .set({
              deletedAt: new Date(),
              deletedBy: ctx.userId,
              updatedAt: new Date(),
            })
            .where(
              and(
                inArray(deals.id, validIds),
                eq(deals.tenantId, ctx.tenantId),
                sql`${deals.deletedAt} IS NULL`
              )
            );
          const deleted = res.rowCount ?? 0;

          // Decrement the tenant's usage counter by the number actually deleted.
          // Mirrors the single-deal DELETE route and the inverse of bulk 'restore';
          // without this, bulk deletes leave currentDeals inflated and can wrongly
          // exhaust the plan's maxDeals limit. Clamp at 0 to avoid drift below zero.
          if (deleted > 0) {
            await tx
              .update(tenants)
              .set({ currentDeals: sql`greatest(0, ${tenants.currentDeals} - ${deleted})` })
              .where(eq(tenants.id, ctx.tenantId));
          }
          return deleted;
        });
        break;
      }

      case 'tag': {
        // Deals don't have a tags column; store under metadata.tags[]
        // Uses atomic dedup: aggregates all existing tags + new tag via DISTINCT
        // so concurrent appends never lose each other's writes.
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const tag = (payload.tag as string | undefined)?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });

        const tagJson = JSON.stringify(tag);
        const res = await db
          .update(deals)
          .set({
            metadata: sql`
              COALESCE(${deals.metadata}, '{}'::jsonb) || jsonb_build_object(
                'tags',
                (
                  SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
                  FROM jsonb_array_elements(
                    COALESCE(${deals.metadata}->'tags', '[]'::jsonb) || jsonb_build_array(${tagJson}::jsonb)
                  ) AS elem
                )
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
        // Uses jsonb || merge so concurrent updates to DIFFERENT metadata fields
        // don't overwrite each other (jsonb_set replaces the whole object path,
        // whereas || merges at the top level of the targeted key).
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const fieldKey = payload['field_key'] as string | undefined;
        const fieldValue = payload['field_value'];
        if (!fieldKey) return NextResponse.json({ error: 'field_key required' }, { status: 400 });

        // Allowlist of safe metadata keys + alphanumeric/underscore only
        const ALLOWED_FIELD_KEYS = new Set([
          'source', 'priority', 'deal_type', 'custom_fields', 'tags', 'notes',
          'expected_close', 'probability', 'next_action', 'competitor', 'loss_reason',
          'closed_amount', 'assigned_team', 'region', 'segment',
        ]);
        const safeFieldKey = fieldKey.replace(/[^a-zA-Z0-9_]/g, '');
        if (safeFieldKey !== fieldKey || !ALLOWED_FIELD_KEYS.has(safeFieldKey)) {
          return NextResponse.json({ error: `field_key '${fieldKey}' is not allowed` }, { status: 400 });
        }

        const patch = JSON.stringify({ [fieldKey]: fieldValue });
        const res = await db
          .update(deals)
          .set({
            metadata: sql`COALESCE(${deals.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
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
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const res = await db
          .update(deals)
          .set({
            metadata: sql`jsonb_set(COALESCE(${deals.metadata}, '{}'::jsonb), '{archived}', 'true'::jsonb)`,
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
      case 'unarchive': {
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const res = await db
          .update(deals)
          .set({
            metadata: sql`jsonb_set(COALESCE(${deals.metadata}, '{}'::jsonb), '{archived}', 'false'::jsonb)`,
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
      case 'restore': {
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;

        // Restore targets SOFT-DELETED rows. The `validIds` set above is built
        // with `deletedAt IS NULL`, so it never contains a trashed deal — reusing
        // it made bulk restore a no-op (and, when it did match live rows, wrongly
        // re-incremented currentDeals). Re-resolve against deletedAt IS NOT NULL.
        const restorable = await db
          .select({ id: deals.id })
          .from(deals)
          .where(
            and(
              inArray(deals.id, deal_ids),
              eq(deals.tenantId, ctx.tenantId),
              sql`${deals.deletedAt} IS NOT NULL`,
              mine
            )
          );
        const restorableIds = restorable.map(r => r.id);
        auditIds = restorableIds;
        if (!restorableIds.length) return NextResponse.json({ error: 'No deleted deals found to restore' }, { status: 404 });

        // Plan limit check: restoring deals could push count over limit
        const [tenantWithPlan] = await db
          .select({
            currentDeals: tenants.currentDeals,
            maxDeals: plans.maxDeals,
          })
          .from(tenants)
          .innerJoin(plans, eq(plans.id, tenants.planId))
          .where(eq(tenants.id, ctx.tenantId));

        if (tenantWithPlan && tenantWithPlan.maxDeals != null && ((tenantWithPlan.currentDeals ?? 0) + restorableIds.length) > tenantWithPlan.maxDeals) {
          return NextResponse.json({ error: `Restore would exceed plan limit of ${tenantWithPlan.maxDeals} deals.` }, { status: 403 });
        }

        // Wrap the restore + tenant-counter re-increment so the two writes
        // succeed or fail together (H7), the inverse of the 'delete' case.
        affected = await db.transaction(async (tx) => {
          const res = await tx
            .update(deals)
            .set({
              deletedAt: null,
              deletedBy: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                inArray(deals.id, restorableIds),
                eq(deals.tenantId, ctx.tenantId),
                sql`${deals.deletedAt} IS NOT NULL`
              )
            );
          const restored = res.rowCount ?? 0;

          // Re-increment the tenant's usage counter only for rows actually
          // restored (mirrors single restore in trash route).
          if (restored > 0) {
            await tx
              .update(tenants)
              .set({ currentDeals: sql`${tenants.currentDeals} + ${restored}` })
              .where(eq(tenants.id, ctx.tenantId));
          }
          return restored;
        });
        break;
      }
      case 'add_to_segment': {
        const deny = requirePerm(ctx, 'deals.edit');
        if (deny) return deny;
        const segId = payload['segment_id'] as string | undefined;
        if (!segId) return NextResponse.json({ error: 'segment_id required' }, { status: 400 });
        const [seg] = await db.select({ id: segments.id }).from(segments)
          .where(and(eq(segments.id, segId), eq(segments.tenantId, ctx.tenantId), isNull(segments.deletedAt)))
          .limit(1);
        if (!seg) return NextResponse.json({ error: 'Segment not found' }, { status: 404 });
        const memberValues = validIds.map(entityId => ({ segmentId: segId, entityId, tenantId: ctx.tenantId }));
        const inserted = await db.insert(segmentMembers).values(memberValues).onConflictDoNothing().returning({ entityId: segmentMembers.entityId });
        affected = inserted.length;
        auditIds = inserted.map(r => r.entityId);
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, entityType: 'deal',
      newData: bulkIdsAudit({ idsKey: 'deal_ids', ids: auditIds, affected, payload }),
    });

    return NextResponse.json({ ok: true, affected, action });
  } catch (err) {
    await logError({ error: err, context: 'tenant/deals bulk POST', requestMethod: 'POST' });
    await logError({ error: err, context: 'deals/bulk', tenantId: ctx?.tenantId });
    return apiError(err);
  }
});
