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
import { dataRetentionPolicies } from '@/drizzle/schema/compliance';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard, checkStaleUpdate } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

const retentionPolicySchema = z.object({
  entityType: z.enum(['contacts', 'deals', 'activities', 'emails', 'audit_logs', 'notes', 'tasks']),
  retentionDays: z.number().int().min(1).max(3650),
  action: z.enum(['archive', 'delete', 'anonymize']),
  isActive: z.boolean().optional().default(true),
});

const updateRetentionPolicySchema = z.object({
  id: z.string().uuid(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  action: z.enum(['archive', 'delete', 'anonymize']).optional(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const policies = await db
      .select()
      .from(dataRetentionPolicies)
      .where(eq(dataRetentionPolicies.tenantId, ctx.tenantId));

    return NextResponse.json({ data: policies });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const limited = await rateLimitMutating(req, 'retentionPolicies', 'post');
    if (limited) return limited;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const body = await readJsonBody(req);
    const validated = validateBody(retentionPolicySchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Check for existing policy for same entity type
    const existing = await db
      .select()
      .from(dataRetentionPolicies)
      .where(
        and(
          eq(dataRetentionPolicies.tenantId, ctx.tenantId),
          eq(dataRetentionPolicies.entityType, v.entityType)
        )
      );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: `A retention policy for "${v.entityType}" already exists. Use PUT to update.` },
        { status: 409 }
      );
    }

    const [policy] = await db.insert(dataRetentionPolicies).values({
      tenantId: ctx.tenantId,
      entityType: v.entityType,
      retentionDays: v.retentionDays,
      action: v.action,
      isActive: v.isActive,
    }).returning();

    return NextResponse.json({ data: policy }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});

export const PUT = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const limited = await rateLimitMutating(req, 'retentionPolicies', 'put');
    if (limited) return limited;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance', ctx.isSuperAdmin);
    if (moduleGate) return moduleGate;

    const body = await readJsonBody(req);
    const validated = validateBody(updateRetentionPolicySchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (v.retentionDays !== undefined) updateData['retentionDays'] = v.retentionDays;
    if (v.action !== undefined) updateData['action'] = v.action;
    if (v.isActive !== undefined) updateData['isActive'] = v.isActive;

    const concurrencyWhere = concurrencyGuard(dataRetentionPolicies, v.expectedUpdatedAt);
    const whereConditions = [
      eq(dataRetentionPolicies.id, v.id),
      eq(dataRetentionPolicies.tenantId, ctx.tenantId),
    ];
    if (concurrencyWhere) whereConditions.push(concurrencyWhere);

    const [updated] = await db.update(dataRetentionPolicies)
      .set(updateData)
      .where(and(...whereConditions))
      .returning();

    const stale = checkStaleUpdate(updated);
    if (stale) return stale;

    return NextResponse.json({ data: updated });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
});
