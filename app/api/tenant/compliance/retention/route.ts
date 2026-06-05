import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { dataRetentionPolicies } from '@/drizzle/schema/compliance';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

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
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'compliance');
    if (moduleGate) return moduleGate;

    const policies = await db
      .select()
      .from(dataRetentionPolicies)
      .where(eq(dataRetentionPolicies.tenantId, ctx.tenantId));

    return NextResponse.json({ data: policies });
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance');
    if (moduleGate) return moduleGate;

    const body = await req.json();
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
  } catch (err: any) { return apiError(err); }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'compliance');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const validated = validateBody(updateRetentionPolicySchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (v.retentionDays !== undefined) updateData['retentionDays'] = v.retentionDays;
    if (v.action !== undefined) updateData['action'] = v.action;
    if (v.isActive !== undefined) updateData['isActive'] = v.isActive;

    const [updated] = await db.update(dataRetentionPolicies)
      .set(updateData)
      .where(
        and(
          eq(dataRetentionPolicies.id, v.id),
          eq(dataRetentionPolicies.tenantId, ctx.tenantId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated });
  } catch (err: any) { return apiError(err); }
}
