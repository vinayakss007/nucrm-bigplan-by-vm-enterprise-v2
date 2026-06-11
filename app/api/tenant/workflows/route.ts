import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createWorkflowSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { workflows, workflowActions, workflowExecutions } from '@/drizzle/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';

/**
 * GET /api/tenant/workflows
 * List all workflows
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';

    const filters = [
      eq(workflows.tenantId, ctx.tenantId),
      isNull(workflows.deletedAt)
    ];

    if (status !== 'all') {
      filters.push(eq(workflows.status, status));
    }

    const data = await db.query.workflows.findMany({
        limit: 200,
      where: and(...filters),
      orderBy: [desc(workflows.createdAt)],
      extras: {
        executions_30d: sql<number>`(SELECT count(*) FROM workflow_executions WHERE workflow_id = workflows.id AND started_at > now() - interval '30 days')`.as('executions_30d')
      }
    });

    return NextResponse.json({
      data,
    });
  } catch (error: any) {
    console.error('[Workflows] GET error:', error);
    return apiError(error);
  }
}

/**
 * POST /api/tenant/workflows
 * Create new workflow
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const rawBody = await request.json();
    const validated = validateBody(createWorkflowSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const {
      name,
      description,
      trigger_type,
      trigger_config = {},
      nodes = [],
    } = v;
    const actions = rawBody.actions || [];

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!trigger_type) {
      return NextResponse.json({ error: 'trigger_type is required' }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      // 1. Create workflow
      const [newWorkflow] = await tx.insert(workflows).values({
        tenantId: ctx.tenantId,
        name: name.trim(),
        description: description || null,
        triggerType: trigger_type,
        triggerConfig: trigger_config,
        nodes: nodes,
        createdBy: ctx.userId,
      }).returning();

      // 2. Create actions if provided
      if (actions.length > 0) {
        const actionValues = actions.map((action: any, index: number) => ({
          workflowId: newWorkflow.id,
          tenantId: ctx.tenantId,
          orderIndex: index + 1,
          actionType: action.action_type || 'email',
          config: action.action_config || {},
          conditionConfig: action.condition_config || {},
        }));

        await tx.insert(workflowActions).values(actionValues);
      }

      return newWorkflow;
    });

    return NextResponse.json({
      ok: true,
      data: result,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Workflows] POST error:', error);
    return apiError(error);
  }
}
