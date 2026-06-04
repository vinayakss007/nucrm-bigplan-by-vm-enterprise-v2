/**
 * Lead Scoring Rule (admin only)
 *
 *   PATCH  /api/tenant/admin/lead-scoring/[id]      — update rule
 *   DELETE /api/tenant/admin/lead-scoring/[id]      — soft-delete rule
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { leadScoringRules } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const { factor, weight, condition, active } = body;

    const [row] = await db
      .update(leadScoringRules)
      .set({
        ...(typeof factor === 'string' ? { factor: factor.trim().slice(0, 500) } : {}),
        ...(typeof weight === 'number' ? { weight } : {}),
        ...(typeof condition === 'string' ? { condition: condition.trim().slice(0, 1000) } : {}),
        ...(typeof active === 'boolean' ? { active } : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(leadScoringRules.id, id),
        eq(leadScoringRules.tenantId, ctx.tenantId),
        isNull(leadScoringRules.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_lead_scoring_rule', entityType: 'lead_scoring_rule',
      entityId: id, newData: body,
    });

    return NextResponse.json({ rule: row });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;

    const [row] = await db
      .update(leadScoringRules)
      .set({
        deletedAt: new Date(),
      })
      .where(and(
        eq(leadScoringRules.id, id),
        eq(leadScoringRules.tenantId, ctx.tenantId),
        isNull(leadScoringRules.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'delete_lead_scoring_rule', entityType: 'lead_scoring_rule',
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
