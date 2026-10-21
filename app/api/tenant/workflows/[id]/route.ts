/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { workflows, workflowActions, workflowExecutions } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';
import { WORKFLOW_TRIGGER_TYPES, isWorkflowTriggerType } from '@/lib/automation/workflow-trigger';

/**
 * GET /api/tenant/workflows/[id]
 * Get workflow details with actions
 */

interface WorkflowActionInput {
  action_type?: string | null;
  action_config?: Record<string, unknown> | null;
  condition_config?: Record<string, unknown> | null;
}
export const GET = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const workflow = await db.query.workflows.findFirst({
      where: and(eq(workflows.id, id), eq(workflows.tenantId, ctx.tenantId))
    });

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const actions = await db.query.workflowActions.findMany({
        limit: 200,
      where: eq(workflowActions.workflowId, id),
      orderBy: [workflowActions.orderIndex]
    });

    const executions = await db.query.workflowExecutions.findMany({
      where: eq(workflowExecutions.workflowId, id),
      orderBy: [desc(workflowExecutions.startedAt)],
      limit: 10
    });

    return NextResponse.json({
      data: {
        ...workflow,
        actions,
        recentExecutions: executions,
      },
    });
 
 
  } catch (error) {
    await logError({ error: error, context: 'Workflow GET error', requestMethod: 'GET' });
    return apiError(error);
  }
});

/**
 * PATCH /api/tenant/workflows/[id]
 * Update workflow
 */
export const PATCH = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'workflows', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const body = await readJsonBody(request);

    // Optimistic concurrency: reject stale writes
    const expectedUpdatedAt = body?.expectedUpdatedAt ?? body?._updated_at;
    if (expectedUpdatedAt) {
      const guard = await concurrencyGuard(db, workflows, id, ctx.tenantId, expectedUpdatedAt);
      if (guard) return guard;
    }

    const {
      name,
      description,
      status,
      trigger_type,
      trigger_config,
      nodes,
      actions,
    } = body;

    // #2806 (a): `trigger_type` is the kind and the column is gated by
    // chk_workflows_trigger_type, which admits exactly WORKFLOW_TRIGGER_TYPES.
    // POST answers out-of-set values with a 400 naming the allowed list; PATCH
    // used to drop the key entirely, so editing the trigger was a silent no-op.
    // Same rule here — reject at the door, never let a dotted value reach the
    // database and surface as a 23514.
    if (trigger_type !== undefined && !isWorkflowTriggerType(trigger_type)) {
      return NextResponse.json({
        error: `trigger_type must be one of: ${WORKFLOW_TRIGGER_TYPES.join(', ')}`,
      }, { status: 400 });
    }

    // Validation before publishing
    if (status === 'active') {
      const workflowResult = await db.query.workflows.findFirst({
        where: eq(workflows.id, id),
        columns: { nodes: true }
      });
      const actionsCountResult = await db.select({ count: sql<number>`count(*)::int` })
        .from(workflowActions)
        .where(eq(workflowActions.workflowId, id));
      
      const currentNodes = nodes || workflowResult?.nodes || [];
      const currentActionsCount = actions !== undefined ? actions.length : (actionsCountResult[0]?.count || 0);

      if (!currentNodes || (currentNodes as unknown[]).length === 0) {
        return NextResponse.json({ error: 'Cannot activate workflow without nodes' }, { status: 400 });
      }
      if (currentActionsCount === 0) {
        return NextResponse.json({ error: 'Cannot activate workflow without at least one action' }, { status: 400 });
      }
    }

    await db.transaction(async (tx) => {
      // Update workflow fields
 
 
      const updateData: Partial<typeof workflows.$inferInsert> = { updatedAt: new Date(), updatedBy: ctx.userId };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (status !== undefined) updateData.status = status;
      if (trigger_type !== undefined) updateData.triggerType = trigger_type;
      if (trigger_config !== undefined) updateData.triggerConfig = trigger_config;
      if (nodes !== undefined) updateData.nodes = nodes;

      if (Object.keys(updateData).length > 2) { // More than just updatedAt and updatedBy
        await tx.update(workflows)
          .set(updateData)
          .where(and(eq(workflows.id, id), eq(workflows.tenantId, ctx.tenantId)));
      }

      // Update actions if provided
      if (actions !== undefined) {
        // Delete existing actions
        await tx.delete(workflowActions).where(eq(workflowActions.workflowId, id));

        // Insert new actions
        if (actions.length > 0) {
 
 
          const actionValues = (actions as WorkflowActionInput[]).map((action, index) => ({
            workflowId: id,
            tenantId: ctx.tenantId,
            orderIndex: index + 1,
            actionType: action.action_type ?? 'send_email',
            config: action.action_config ?? {},
            conditionConfig: action.condition_config ?? {},
          }));

          await tx.insert(workflowActions).values(actionValues);
        }
      }
    });

    return NextResponse.json({
      ok: true,
      message: 'Workflow updated',
    });
 
 
  } catch (error) {
    await logError({ error: error, context: 'Workflow PATCH error', requestMethod: 'PATCH' });
    return apiError(error);
  }
});

/**
 * DELETE /api/tenant/workflows/[id]
 * Delete workflow
 */
export const DELETE = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
  const limited = await rateLimitMutating(request, 'workflows', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    await db.update(workflows).set({ deletedAt: new Date() }).where(and(eq(workflows.id, id), eq(workflows.tenantId, ctx.tenantId)));

    return NextResponse.json({
      ok: true,
      message: 'Workflow deleted',
    });
 
 
  } catch (error) {
    await logError({ error: error, context: 'Workflow DELETE error', requestMethod: 'DELETE' });
    return apiError(error);
  }
});

// #2806 — this file used to also export a POST whose comment claimed the path
// `POST /api/tenant/workflows/[id]/test`. Next.js serves this file at
// `/workflows/:id`, so the Test button's `/workflows/:id/test` request had no
// handler at all (a straight 404) while a `POST /workflows/:id` nobody calls
// silently existed. The handler moved to `test/route.ts`, where the path and
// the comment finally agree, and runs the same engine as `run/route.ts`.
