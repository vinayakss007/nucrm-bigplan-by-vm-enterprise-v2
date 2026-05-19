import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { workflows } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * POST /api/tenant/workflows/[id]/run
 * Manually trigger a workflow execution for testing
 */
export async function POST(
  request: NextRequest,
  { params }: any
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

    const body = await request.json();
    const { trigger_entity_type, trigger_entity_id } = body;

    if (!trigger_entity_type || !trigger_entity_id) {
      return NextResponse.json(
        { error: 'trigger_entity_type and trigger_entity_id are required' },
        { status: 400 }
      );
    }

    // Execute workflow
    const result = await db.execute(
      sql`SELECT public.execute_workflow(${id}, ${trigger_entity_type}, ${trigger_entity_id}) as execution_id`
    );

    return NextResponse.json({
      ok: true,
      execution_id: (result.rows[0] as any)?.execution_id,
      message: 'Workflow execution started',
    }, { status: 202 });
  } catch (err: any) {
    console.error('[Workflow Run] POST error:', err);
    return apiError(err);
  }
}
