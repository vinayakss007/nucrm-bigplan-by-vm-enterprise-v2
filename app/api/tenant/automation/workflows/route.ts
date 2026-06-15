import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requireModule } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { automationWorkflows } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { getAllWorkflows } from '@/lib/automation/workflows';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'automation-basic');
    if (modErr) return modErr;

    // Get all prebuilt workflows
    const allWorkflows = getAllWorkflows();

    // Get tenant's enabled workflows
    const tenantWorkflows = await db.select({
      workflowId: automationWorkflows.workflowId,
      enabled: automationWorkflows.enabled,
      config: automationWorkflows.config
    })
    .from(automationWorkflows)
    .where(eq(automationWorkflows.tenantId, ctx.tenantId));

    // Merge with prebuilt definitions
    const workflows = allWorkflows.map(workflow => {
      const tenant = tenantWorkflows.find(t => t.workflowId === workflow.id);
      return {
        ...workflow,
        enabled: tenant?.enabled || false,
        config: tenant?.config || {},
        last_run_at: null,
        run_count: 0
      };
    });

    return NextResponse.json({ data: workflows });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'automation-basic');
    if (modErr) return modErr;

    const { workflow_id, enabled, config } = await request.json();

    // Get workflow definition
    const workflow = getAllWorkflows().find(w => w.id === workflow_id);
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Upsert tenant workflow
    await db.insert(automationWorkflows)
      .values({
        tenantId: ctx.tenantId,
        workflowId: workflow_id,
        name: workflow.name,
        description: workflow.description,
        enabled: enabled,
        config: config || {},
      })
      .onConflictDoUpdate({
        target: [automationWorkflows.tenantId, automationWorkflows.workflowId],
        set: {
          enabled: enabled,
          config: config || {},
          updatedAt: new Date(),
        }
      });

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
