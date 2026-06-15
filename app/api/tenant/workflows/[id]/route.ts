import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { workflows, workflowActions, workflowExecutions } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * GET /api/tenant/workflows/[id]
 * Get workflow details with actions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Workflow] GET error:', error);
    return apiError(error);
  }
}

/**
 * PATCH /api/tenant/workflows/[id]
 * Update workflow
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const body = await request.json();
    const {
      name,
      description,
      status,
      trigger_config,
      nodes,
      actions,
    } = body;

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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = { updatedAt: new Date(), updatedBy: ctx.userId };
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (status !== undefined) updateData.status = status;
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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
          const actionValues = actions.map((action: any, index: number) => ({
            workflowId: id,
            tenantId: ctx.tenantId,
            orderIndex: index + 1,
            actionType: action.action_type || 'send_email',
            config: action.action_config || {},
            conditionConfig: action.condition_config || {},
          }));

          await tx.insert(workflowActions).values(actionValues);
        }
      }
    });

    return NextResponse.json({
      ok: true,
      message: 'Workflow updated',
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Workflow] PATCH error:', error);
    return apiError(error);
  }
}

/**
 * DELETE /api/tenant/workflows/[id]
 * Delete workflow
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    await db.delete(workflows).where(and(eq(workflows.id, id), eq(workflows.tenantId, ctx.tenantId)));

    return NextResponse.json({
      ok: true,
      message: 'Workflow deleted',
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Workflow] DELETE error:', error);
    return apiError(error);
  }
}

/**
 * POST /api/tenant/workflows/[id]/test
 * Test workflow execution
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const body = await request.json();
    const { trigger_entity_type, trigger_entity_id } = body;

    if (!trigger_entity_type || !trigger_entity_id) {
      return NextResponse.json({ 
        error: 'trigger_entity_type and trigger_entity_id are required' 
      }, { status: 400 });
    }

    // Execute workflow using SQL function
    const result = await db.execute(
      sql`SELECT public.execute_workflow(${id}, ${trigger_entity_type}, ${trigger_entity_id}) as execution_id`
    );

    return NextResponse.json({
      ok: true,
      execution_id: (result.rows[0] as Record<string, unknown>)?.execution_id as string,
      message: 'Workflow test started',
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[Workflow Test] POST error:', error);
    return apiError(error);
  }
}
