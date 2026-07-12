/**
 * Lead Scoring Rules (admin only)
 *
 *   GET    /api/tenant/admin/lead-scoring           — list rules
 *   POST   /api/tenant/admin/lead-scoring           — create new rule
 *   PATCH  /api/tenant/admin/lead-scoring           — update rule (active, weight, factor)
 *   DELETE /api/tenant/admin/lead-scoring?id=uuid   — soft-delete
 *
 * These rules are used by the AI lead scoring engine to evaluate and rank leads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leadScoringRules } from '@/drizzle/schema/ai';
import { eq, and, isNull, desc, asc } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { validateBody } from '@/lib/api/validate';
import { createLeadScoringRuleSchema, updateLeadScoringRuleSchema } from '@/lib/api/schemas';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rows = await db
      .select()
      .from(leadScoringRules)
      .where(and(eq(leadScoringRules.tenantId, ctx.tenantId), isNull(leadScoringRules.deletedAt)))
      .orderBy(desc(leadScoringRules.weight), asc(leadScoringRules.sortOrder), desc(leadScoringRules.createdAt));

    return NextResponse.json({ rules: rows });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const parsed = validateBody(createLeadScoringRuleSchema, body);
    if (parsed instanceof NextResponse) return parsed;

    const [row] = await db.insert(leadScoringRules).values({
      tenantId: ctx.tenantId,
      factor: parsed.data.factor,
      weight: parsed.data.weight,
      condition: parsed.data.condition ?? null,
      sortOrder: parsed.data.sortOrder,
      active: parsed.data.active,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    }).returning();

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'create_lead_scoring_rule', entityType: 'lead_scoring_rule',
      entityId: row?.id, newData: { factor, weight },
    });

    return NextResponse.json({ rule: row });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const parsed = validateBody(updateLeadScoringRuleSchema, body);
    if (parsed instanceof NextResponse) return parsed;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };

    if (parsed.data.factor !== undefined) updateData.factor = parsed.data.factor;
    if (parsed.data.weight !== undefined) updateData.weight = parsed.data.weight;
    if (parsed.data.condition !== undefined) updateData.condition = parsed.data.condition;
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.active !== undefined) updateData.active = parsed.data.active;

    const [row] = await db
      .update(leadScoringRules)
      .set(updateData)
      .where(and(eq(leadScoringRules.id, body.id), eq(leadScoringRules.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_lead_scoring_rule', entityType: 'lead_scoring_rule',
      entityId: row.id, newData: updateData,
    });

    return NextResponse.json({ rule: row });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const [row] = await db
      .update(leadScoringRules)
      .set({
        deletedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(leadScoringRules.id, id), eq(leadScoringRules.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'delete_lead_scoring_rule', entityType: 'lead_scoring_rule',
      entityId: row.id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
