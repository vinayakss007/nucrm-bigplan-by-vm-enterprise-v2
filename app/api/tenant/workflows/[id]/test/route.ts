/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { workflows } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { testWorkflowSchema } from '@/lib/api/schemas';
import { readJsonBody, validateBody } from '@/lib/api/validate';
import { executeWorkflow } from '@/lib/automation/workflow-executor';
import { logError } from '@/lib/errors-server';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * POST /api/tenant/workflows/[id]/test
 * Run a workflow against an optional trigger-entity context.
 *
 * #2806 — the builder's Test button has always posted to this path, but the
 * handler lived in `app/api/tenant/workflows/[id]/route.ts`, which Next.js
 * serves as `POST /workflows/:id`. Nothing listened at `/test`, so Test was a
 * 404 no matter what the workflow held. The misplaced handler also called
 * `public.execute_workflow()`, which only inserts a `'running'` executions row
 * and strands it — nothing walks that row forward. This route runs the same
 * engine `/run` uses, so a test produces a completed execution (or a real
 * error) instead of a dangling row.
 *
 * The entity is optional here, unlike `/run`: until the builder grows an
 * entity picker, a test with no entity still exercises the node graph and the
 * actions against an empty context — which is strictly more than a 404 told
 * the operator.
 */
export const POST = withApiRoute(async (request: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }
    const { id } = await params;

    const workflow = await db.query.workflows.findFirst({
      where: and(eq(workflows.id, id), eq(workflows.tenantId, ctx.tenantId)),
      columns: { id: true, name: true, status: true },
    });

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const rawBody = await readJsonBody(request);
    const validated = validateBody(testWorkflowSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const executionId = await executeWorkflow({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      workflowId: id,
      contactId: v.trigger_entity_type === 'contact' ? v.trigger_entity_id : undefined,
      dealId: v.trigger_entity_type === 'deal' ? v.trigger_entity_id : undefined,
      inputData: {
        trigger_type: v.trigger_entity_type,
        trigger_entity_id: v.trigger_entity_id,
        test: true,
      },
    });

    return NextResponse.json({
      ok: true,
      execution_id: executionId,
      message: 'Workflow test completed',
    });
  } catch (err: unknown) {
    void logError({ error: err, context: 'tenant/workflows/[id]/test POST' });
    return apiError(err);
  }
});
