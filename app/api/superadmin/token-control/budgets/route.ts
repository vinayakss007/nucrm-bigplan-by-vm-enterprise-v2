/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tokenBudgets } from '@/drizzle/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/superadmin/token-control/budgets
 * The Budgets tab of /superadmin/token-control. Only the current period —
 * historical rows are a reporting question, not a live control surface.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rows = await db
      .select({
        id: tokenBudgets.id,
        service: tokenBudgets.service,
        monthly_budget_cents: tokenBudgets.monthlyBudgetCents,
        current_month_cents: tokenBudgets.currentMonthCents,
        hard_cap_enabled: tokenBudgets.hardCapEnabled,
        alert_at_50pct: tokenBudgets.alertAt50pct,
        alert_at_80pct: tokenBudgets.alertAt80pct,
        alert_at_100pct: tokenBudgets.alertAt100pct,
      })
      .from(tokenBudgets)
      .where(and(
        isNull(tokenBudgets.deletedAt),
        eq(tokenBudgets.billingPeriod, sql`to_char(now(), 'YYYY-MM')`),
      ))
      .orderBy(asc(tokenBudgets.service));

    return NextResponse.json({ budgets: rows });
  } catch (err: unknown) { return apiError(err); }
});
