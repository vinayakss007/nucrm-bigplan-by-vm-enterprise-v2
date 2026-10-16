/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { ownerScope } from '@/lib/api/owner-scope';
import { db } from '@/drizzle/db';
import { deals, dealForecasts } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const forecastSchema = z.object({
  expected_close_date: z.string().nullable().optional(),
  probability: z.coerce.number().min(0).max(100).optional(),
  forecast_amount: z.coerce.number().min(0).optional(),
  confidence_level: z.enum(['low', 'medium', 'high']).nullable().optional(),
});

/**
 * The parent check `deals/[id]` applies to every verb. `id + tenant_id +
 * deleted_at` alone resolves for a `sales_rep` whose `deals.view_all` is false
 * (`lib/permissions/definitions.ts:135`), which is the caller
 * `deals/[id]/route.ts:67-72` answers 404 (#2709).
 */
async function assertDeal(ctx: AuthContext, dealId: string) {
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(
      eq(deals.id, dealId),
      eq(deals.tenantId, ctx.tenantId),
      sql`${deals.deletedAt} IS NULL`,
      ownerScope(ctx, 'deals.view_all', deals),
    ))
    .limit(1);
  return deal;
}

// GET /api/tenant/deals/:id/forecast - return the forecast for this deal (or empty)
export const GET = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.view');
    if (deny) return deny;
    const dealId = (await params).id;

    if (!(await assertDeal(ctx, dealId))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const [forecast] = await db
      .select()
      .from(dealForecasts)
      .where(
        and(
          eq(dealForecasts.dealId, dealId),
          eq(dealForecasts.tenantId, ctx.tenantId),
          sql`${dealForecasts.deletedAt} IS NULL`
        )
      )
      .limit(1);

    return NextResponse.json({ data: forecast ?? null });
  } catch (err) { return apiError(err); }
});

// POST /api/tenant/deals/:id/forecast - create or update forecast
export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'deal-forecast', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.edit');
    if (deny) return deny;
    const dealId = (await params).id;

    if (!(await assertDeal(ctx, dealId))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const rawBody = await readJsonBody(req);
    const validated = validateBody(forecastSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Check if a forecast already exists for this deal
    const [existing] = await db
      .select({ id: dealForecasts.id })
      .from(dealForecasts)
      .where(
        and(
          eq(dealForecasts.dealId, dealId),
          eq(dealForecasts.tenantId, ctx.tenantId),
          sql`${dealForecasts.deletedAt} IS NULL`
        )
      )
      .limit(1);

    let result;
    if (existing) {
      // Update existing forecast
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (v.expected_close_date !== undefined) updates['predictedCloseDate'] = v.expected_close_date;
      if (v.probability !== undefined) updates['winProbability'] = v.probability.toString();
      if (v.forecast_amount !== undefined) updates['predictedValue'] = v.forecast_amount.toString();
      if (v.confidence_level !== undefined) updates['confidenceLevel'] = v.confidence_level;

      [result] = await db
        .update(dealForecasts)
        .set(updates)
        .where(and(eq(dealForecasts.id, existing.id), eq(dealForecasts.tenantId, ctx.tenantId)))
        .returning();
    } else {
      // Create new forecast
      [result] = await db.insert(dealForecasts).values({
        tenantId: ctx.tenantId,
        dealId,
        predictedCloseDate: v.expected_close_date ?? null,
        winProbability: v.probability !== undefined ? v.probability.toString() : '0',
        predictedValue: v.forecast_amount !== undefined ? v.forecast_amount.toString() : null,
        confidenceLevel: v.confidence_level ?? null,
      }).returning();
    }

    return NextResponse.json({ data: result }, { status: existing ? 200 : 201 });
  } catch (err) { return apiError(err); }
});
