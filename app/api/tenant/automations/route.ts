import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm, requireModule } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { createAutomationSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { automations, automationRuns, users } from '@/drizzle/schema';
import { eq, and, sql, desc, isNull } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const modErr = await requireModule(ctx, 'automation-pro');
    if (modErr) return modErr;
    
    // Subquery for run counts
    const runCounts = db.select({
      automationId: automationRuns.automationId,
      successCount: sql<number>`count(*) FILTER (WHERE status = 'success')::int`.as('success_count'),
      failCount: sql<number>`count(*) FILTER (WHERE status = 'failed')::int`.as('fail_count')
    })
    .from(automationRuns)
    .groupBy(automationRuns.automationId)
    .as('runs');

    const data = await db.select({
      id: automations.id,
      name: automations.name,
      description: automations.description,
      isActive: automations.isActive,
      triggerType: automations.triggerType,
      triggerConfig: automations.triggerConfig,
      actions: automations.actions,
      conditions: automations.conditions,
      runCount: automations.runCount,
      lastRunAt: automations.lastRunAt,
      createdAt: automations.createdAt,
      createdBy: automations.createdBy,
      createdByName: users.fullName,
      successCount: sql<number>`COALESCE(${runCounts.successCount}, 0)`,
      failCount: sql<number>`COALESCE(${runCounts.failCount}, 0)`
    })
    .from(automations)
    .leftJoin(users, eq(users.id, automations.createdBy))
    .leftJoin(runCounts, eq(runCounts.automationId, automations.id))
    .where(and(eq(automations.tenantId, ctx.tenantId), isNull(automations.deletedAt)))
    .orderBy(desc(automations.createdAt));

    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[automations GET]', err);
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'automation-pro');
    if (modErr) return modErr;

    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;

    const body = await req.json();
    const validated = validateBody(createAutomationSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const trigger_type = body.trigger_type;
    const trigger_config = body.trigger_config || {};

    const [newAutomation] = await db.insert(automations)
      .values({
        tenantId: ctx.tenantId,
        name: v.name,
        description: v.description?.trim() || null,
        triggerType: trigger_type,
        triggerConfig: trigger_config,
        actions: v.actions,
        conditions: v.conditions || [],
        isActive: v.is_active,
        createdBy: ctx.userId,
      })
      .returning();

    return NextResponse.json({ data: newAutomation }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[automations POST]', err);
    return apiError(err);
  }
}
