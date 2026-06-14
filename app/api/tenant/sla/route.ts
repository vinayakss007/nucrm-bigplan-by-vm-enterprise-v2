import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { slaPolicies, slaBreaches } from '@/drizzle/schema/sla';
import { eq, and, desc, sql } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const policies = await db
      .select({
        id: slaPolicies.id,
        name: slaPolicies.name,
        priority: slaPolicies.priority,
        responseTimeMinutes: slaPolicies.responseTimeMinutes,
        resolutionTimeMinutes: slaPolicies.resolutionTimeMinutes,
        escalationRules: slaPolicies.escalationRules,
        isActive: slaPolicies.isActive,
        createdAt: slaPolicies.createdAt,
        breachCount: sql<number>`(SELECT count(*)::int FROM ${slaBreaches} WHERE policy_id = ${slaPolicies.id})`,
      })
      .from(slaPolicies)
      .where(
        and(
          eq(slaPolicies.tenantId, ctx.tenantId),
          eq(slaPolicies.isActive, true)
        )
      )
      .orderBy(desc(slaPolicies.createdAt));

    return NextResponse.json({ data: policies });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const { name, priority, responseTimeMinutes, resolutionTimeMinutes, escalationRules } = body;

    if (!name || !priority) {
      return NextResponse.json({ error: 'name and priority are required' }, { status: 400 });
    }

    if (!['critical', 'high', 'medium', 'low'].includes(priority)) {
      return NextResponse.json({ error: 'priority must be critical, high, medium, or low' }, { status: 400 });
    }

    const [policy] = await db.insert(slaPolicies).values({
      tenantId: ctx.tenantId,
      name,
      priority,
      responseTimeMinutes: responseTimeMinutes ?? 240,
      resolutionTimeMinutes: resolutionTimeMinutes ?? 480,
      escalationRules: escalationRules ?? [],
      isActive: true,
    }).returning();

    return NextResponse.json({ data: policy }, { status: 201 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const moduleGate = await requireModule(ctx.tenantId, 'service-helpdesk');
    if (moduleGate) return moduleGate;

    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // Allowlist mutable fields to prevent overwriting tenantId, createdAt, etc.
    const updates: Record<string, unknown> = {};
    if (body['name'] !== undefined) updates['name'] = body['name'];
    if (body['priority'] !== undefined) updates['priority'] = body['priority'];
    if (body['responseTimeMinutes'] !== undefined) updates['responseTimeMinutes'] = body['responseTimeMinutes'];
    if (body['resolutionTimeMinutes'] !== undefined) updates['resolutionTimeMinutes'] = body['resolutionTimeMinutes'];
    if (body['escalationRules'] !== undefined) updates['escalationRules'] = body['escalationRules'];
    if (body['isActive'] !== undefined) updates['isActive'] = body['isActive'];

    const [updated] = await db.update(slaPolicies)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(slaPolicies.id, id), eq(slaPolicies.tenantId, ctx.tenantId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    return NextResponse.json({ data: updated });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
