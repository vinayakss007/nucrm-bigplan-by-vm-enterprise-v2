/**
 * At-Risk Detection Rule (admin only)
 *
 *   PATCH  /api/tenant/admin/at-risk/[id]      — update rule
 *   DELETE /api/tenant/admin/at-risk/[id]      — soft-delete rule
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { atRiskRules } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { validateBody } from '@/lib/api/validate';
import { updateAtRiskRuleSchema } from '@/lib/api/schemas';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const validated = validateBody(updateAtRiskRuleSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.update(atRiskRules)
      .set({
        stageId: v.stage_id !== undefined ? (v.stage_id || null) : undefined,
        maxDaysIdle: v.max_days_idle,
        maxDaysInStage: v.max_days_in_stage,
        sentimentThreshold: v.sentiment_threshold,
        description: v.description,
        active: v.active,
        metadata: v.metadata,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(
        eq(atRiskRules.id, params.id),
        eq(atRiskRules.tenantId, ctx.tenantId),
        isNull(atRiskRules.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit(ctx, {
      action: 'update_at_risk_rule',
      entityType: 'at_risk_rule',
      entityId: row.id,
      description: `Updated at-risk rule ${row.id}`,
      metadata: { rule: row },
    });

    return NextResponse.json(row);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const [row] = await db.update(atRiskRules)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
      })
      .where(and(
        eq(atRiskRules.id, params.id),
        eq(atRiskRules.tenantId, ctx.tenantId),
        isNull(atRiskRules.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit(ctx, {
      action: 'delete_at_risk_rule',
      entityType: 'at_risk_rule',
      entityId: row.id,
      description: `Deleted at-risk rule ${row.id}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
