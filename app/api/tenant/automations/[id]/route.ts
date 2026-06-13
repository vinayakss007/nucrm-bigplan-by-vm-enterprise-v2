import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm, requireModule } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { automations, automationRuns, users } from '@/drizzle/schema';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { validateBody } from '@/lib/api/validate';
import { updateAutomationSchema } from '@/lib/api/schemas';

/**
 * GET /api/tenant/automations/[id]
 * Get automation details and recent runs
 */
export async function GET(
  req: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'automation-pro');
    if (modErr) return modErr;
    
    const { id } = await params;
    
    const automation = await db.query.automations.findFirst({
      where: and(
        eq(automations.id, id),
        eq(automations.tenantId, ctx.tenantId),
        isNull(automations.deletedAt)
      ),
    });

    if (!automation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    let createdByName: string | null | undefined;
    if (automation.createdBy) {
      const creator = await db.query.users.findFirst({
        where: eq(users.id, automation.createdBy),
        columns: { fullName: true },
      });
      createdByName = creator?.fullName;
    }

    const runs = await db.query.automationRuns.findMany({
      where: eq(automationRuns.automationId, id),
      orderBy: [desc(automationRuns.createdAt)],
      limit: 20
    });

    // Map to legacy format for frontend compatibility if needed
    const recentRuns = runs.map(run => ({
      id: run.id,
      status: run.status,
      trigger_type: run.triggerEvent,
      actions_run: run.stepsCompleted,
      duration_ms: (run.metadata as Record<string, unknown>)?.['duration_ms'] as number || 0,
      error: run.errorMessage,
      created_at: run.createdAt
    }));

    const createdName = createdByName;
    return NextResponse.json({ 
      data: { 
        ...automation, 
        created_by_name: createdName,
        recent_runs: recentRuns 
      } 
    });
  } catch (err: any) { 
    console.error('[automation GET]', err);
    return apiError(err); 
  }
}

/**
 * PATCH /api/tenant/automations/[id]
 * Update automation
 */
export async function PATCH(
  req: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const modErr = await requireModule(ctx, 'automation-pro');
    if (modErr) return modErr;

    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;

    const { id } = await params;
    const rawBody = await req.json();
    const validated = validateBody(updateAutomationSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const body = validated.data;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) updateData['name'] = body.name;
    if (body.description !== undefined) updateData['description'] = body.description;
    if (body.is_active !== undefined) updateData['isActive'] = body.is_active;
    if (rawBody.trigger_type !== undefined) updateData['triggerType'] = rawBody.trigger_type;
    if (rawBody.trigger_config !== undefined) updateData['triggerConfig'] = rawBody.trigger_config;
    if (body.actions !== undefined) updateData['actions'] = body.actions;
    if (body.conditions !== undefined) updateData['conditions'] = body.conditions;

    const [row] = await db.update(automations)
      .set(updateData)
      .where(and(
        eq(automations.id, id),
        eq(automations.tenantId, ctx.tenantId),
        isNull(automations.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
  } catch (err: any) { 
    console.error('[automation PATCH]', err);
    return apiError(err); 
  }
}

/**
 * DELETE /api/tenant/automations/[id]
 * Delete automation (soft delete)
 */
export async function DELETE(
  req: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const modErr = await requireModule(ctx, 'automation-pro');
    if (modErr) return modErr;

    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;

    const { id } = await params;

    const [deleted] = await db.update(automations)
      .set({ 
        deletedAt: new Date(),
        deletedBy: ctx.userId 
      })
      .where(and(
        eq(automations.id, id),
        eq(automations.tenantId, ctx.tenantId),
        isNull(automations.deletedAt)
      ))
      .returning({ id: automations.id });

    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (err: any) { 
    console.error('[automation DELETE]', err);
    return apiError(err); 
  }
}
