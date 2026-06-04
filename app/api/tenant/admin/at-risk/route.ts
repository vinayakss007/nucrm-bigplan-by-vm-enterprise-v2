/**
 * At-Risk Detection Rules (admin only)
 *
 *   GET    /api/tenant/admin/at-risk           — list rules
 *   POST   /api/tenant/admin/at-risk           — create new rule
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { atRiskRules } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { validateBody } from '@/lib/api/validate';
import { atRiskRuleSchema } from '@/lib/api/schemas';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rules = await db.select()
      .from(atRiskRules)
      .where(and(
        eq(atRiskRules.tenantId, ctx.tenantId),
        isNull(atRiskRules.deletedAt)
      ))
      .orderBy(desc(atRiskRules.createdAt));

    return NextResponse.json(rules);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const validated = validateBody(atRiskRuleSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [row] = await db.insert(atRiskRules).values({
      tenantId: ctx.tenantId,
      stageId: v.stage_id || null,
      maxDaysIdle: v.max_days_idle,
      maxDaysInStage: v.max_days_in_stage,
      sentimentThreshold: v.sentiment_threshold,
      description: v.description,
      active: v.active,
      metadata: v.metadata,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    }).returning();

    if (!row) return NextResponse.json({ error: 'Failed to create' }, { status: 500 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'create_at_risk_rule',
      entityType: 'at_risk_rule',
      entityId: row.id,
      metadata: { rule: row },
    });

    return NextResponse.json(row);
  } catch (error) {
    return apiError(error);
  }
}
