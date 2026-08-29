/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { assignmentRules } from '@/drizzle/schema/assignment';
import { eq, and, desc } from 'drizzle-orm';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'automation-pro', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const rules = await db
      .select()
      .from(assignmentRules)
      .where(
        and(
          eq(assignmentRules.tenantId, ctx.tenantId),
          eq(assignmentRules.isActive, true)
        )
      )
      .orderBy(desc(assignmentRules.priority));

    return NextResponse.json({ data: rules });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'automation-pro', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const body = await readJsonBody(req);
    const { name, type, config, priority, entityType } = body;

    if (!name || !type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    if (!['round_robin', 'territory', 'skill_based', 'weighted'].includes(type)) {
      return NextResponse.json(
        { error: 'type must be round_robin, territory, skill_based, or weighted' },
        { status: 400 }
      );
    }

    const [rule] = await db.insert(assignmentRules).values({
      tenantId: ctx.tenantId,
      name,
      type,
      config: config ?? {},
      isActive: true,
      priority: priority ?? 0,
      entityType: entityType ?? 'lead',
    }).returning();

    return NextResponse.json({ data: rule }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const PUT = withApiRoute(async (req: NextRequest) => {
  try {
  const limited = await rateLimitMutating(req, 'assignments', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'automation-pro', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const body = await readJsonBody(req);
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Allowlist mutable fields to prevent overwriting tenantId, createdAt, etc.
    const updates: Record<string, unknown> = {};
    if (body['name'] !== undefined) updates['name'] = body['name'];
    if (body['type'] !== undefined) updates['type'] = body['type'];
    if (body['config'] !== undefined) updates['config'] = body['config'];
    if (body['isActive'] !== undefined) updates['isActive'] = body['isActive'];
    if (body['priority'] !== undefined) updates['priority'] = body['priority'];

    const expectedUpdatedAt = body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, assignmentRules, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [updated] = await db.update(assignmentRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(assignmentRules.id, id), eq(assignmentRules.tenantId, ctx.tenantId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const DELETE = withApiRoute(async (req: NextRequest) => {
  try {
  const limited = await rateLimitMutating(req, 'assignments', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'automation-pro', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 });
    }

    // Soft delete
    const [deleted] = await db.update(assignmentRules)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(assignmentRules.id, id), eq(assignmentRules.tenantId, ctx.tenantId)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id, deleted: true } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});
