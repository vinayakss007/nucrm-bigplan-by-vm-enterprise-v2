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

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rows = await db
      .select()
      .from(leadScoringRules)
      .where(and(eq(leadScoringRules.tenantId, ctx.tenantId), isNull(leadScoringRules.deletedAt)))
      .orderBy(asc(leadScoringRules.sortOrder), desc(leadScoringRules.createdAt));

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

    const body = await req.json().catch(() => ({}));
    if (!body.factor) return NextResponse.json({ error: 'factor required' }, { status: 400 });

    const [row] = await db.insert(leadScoringRules).values({
      tenantId: ctx.tenantId,
      factor: String(body.factor).trim().slice(0, 200),
      weight: Number(body.weight) || 10,
      condition: body.condition ? String(body.condition).slice(0, 1000) : null,
      sortOrder: Number(body.sortOrder) || 0,
      active: body.active !== false,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    }).returning();

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'create_lead_scoring_rule', entityType: 'lead_scoring_rule',
      entityId: row?.id, newData: { factor: row?.factor, weight: row?.weight },
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

    const body = await req.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const updateData: any = {
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };

    if (body.factor !== undefined) updateData.factor = String(body.factor).trim().slice(0, 200);
    if (body.weight !== undefined) updateData.weight = Number(body.weight);
    if (body.condition !== undefined) updateData.condition = body.condition ? String(body.condition).slice(0, 1000) : null;
    if (body.sortOrder !== undefined) updateData.sortOrder = Number(body.sortOrder);
    if (body.active !== undefined) updateData.active = Boolean(body.active);

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
