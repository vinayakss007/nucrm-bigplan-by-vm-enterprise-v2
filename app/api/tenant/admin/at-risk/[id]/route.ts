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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    const body = await req.json();
    const validated = validateBody(updateAtRiskRuleSchema, body);
    if (validated instanceof NextResponse) return validated;

    const [row] = await db.update(atRiskRules)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(atRiskRules.id, id))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update_at_risk_rule',
      entityType: 'at_risk_rule',
      entityId: row.id,
      metadata: { rule: row },
    });

    return NextResponse.json(row);
  } catch (error) {
    return apiError(error);
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

    const [row] = await db.update(atRiskRules)
      .set({
        deletedAt: new Date(),
      })
      .where(and(
        eq(atRiskRules.id, id),
        eq(atRiskRules.tenantId, ctx.tenantId),
        isNull(atRiskRules.deletedAt)
      ))
      .returning();

    if (!row) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete_at_risk_rule',
      entityType: 'at_risk_rule',
      entityId: row.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
