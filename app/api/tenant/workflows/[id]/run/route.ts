import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { triggerWorkflowSchema } from '@/lib/api/schemas';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { workflows } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { executeWorkflow } from '@/lib/automation/workflow-executor';

/**
 * POST /api/tenant/workflows/[id]/run
 * Manually trigger a workflow execution
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

    // Verify workflow belongs to tenant
    const workflow = await db.query.workflows.findFirst({
      where: and(eq(workflows.id, id), eq(workflows.tenantId, ctx.tenantId)),
      columns: { id: true, name: true, status: true }
    });

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const rawBody = await request.json();
    const validated = validateBody(triggerWorkflowSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Execute workflow using the new engine
    const executionId = await executeWorkflow({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      workflowId: id,
      contactId: v.trigger_entity_type === 'contact' ? v.trigger_entity_id : undefined,
      dealId: v.trigger_entity_type === 'deal' ? v.trigger_entity_id : undefined,
      inputData: {
        trigger_type: v.trigger_entity_type,
        trigger_entity_id: v.trigger_entity_id,
      },
    });

    return NextResponse.json({
      ok: true,
      execution_id: executionId,
      message: 'Workflow execution completed',
    });
  } catch (err: unknown) {
    console.error('[Workflow Run] POST error:', err);
    return apiError(err);
  }
}
