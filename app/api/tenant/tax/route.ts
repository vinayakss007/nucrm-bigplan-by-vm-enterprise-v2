/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { taxRates } from '@/drizzle/schema/financial';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

export const createTaxRateSchema = z.object({
  name: z.string().min(1, 'name is required'),
  // #658 BUG-12: rate is stored/returned as a string (DB text/decimal), so the
  // edit round-trip sends a numeric string back. Coerce accepts both a number
  // and a numeric string; a non-numeric string still fails validation.
  rate: z.coerce.number().min(0, 'rate is required'),
  type: z.enum(['percentage', 'fixed']).optional().default('percentage'),
  country: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

export const updateTaxRateSchema = z.object({
  id: z.string().uuid('Tax rate ID is required'),
  name: z.string().optional(),
  // #658 BUG-12: accept the numeric-string round-trip (see create schema note).
  rate: z.coerce.number().min(0).optional(),
  type: z.enum(['percentage', 'fixed']).optional(),
  country: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  isDefault: z.boolean().optional(),
});

/**
 * GET /api/tenant/tax
 * List tax rates for the tenant.
 * Module-gated to 'sales-quotes'.
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes', ctx.isSuperAdmin);
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const country = searchParams.get('country');
    const state = searchParams.get('state');
    const activeOnly = searchParams.get('active') !== 'false';

    const filters: ReturnType<typeof eq>[] = [eq(taxRates.tenantId, ctx.tenantId)];
    if (activeOnly) filters.push(eq(taxRates.isActive, true));
    if (country) filters.push(eq(taxRates.country, country));
    if (state) filters.push(eq(taxRates.state, state));

    const rates = await db.select().from(taxRates).where(and(...filters));

    return NextResponse.json({ data: rates, total: rates.length });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

/**
 * POST /api/tenant/tax
 * Create a new tax rate.
 * Module-gated to 'sales-quotes'.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes', ctx.isSuperAdmin);
    if (gate) return gate;

    const raw = await readJsonBody(req);
    const parsed = validateBody(createTaxRateSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { name, rate, type, country, state, isDefault } = parsed.data;

    const [row] = await db.insert(taxRates).values({
      tenantId: ctx.tenantId,
      name,
      rate: String(rate),
      type,
      country: country || null,
      state: state || null,
      isDefault,
    }).returning();

    return NextResponse.json({ data: row }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

/**
 * PUT /api/tenant/tax
 * Update a tax rate.
 * Module-gated to 'sales-quotes'.
 */
export const PUT = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes', ctx.isSuperAdmin);
    if (gate) return gate;

    const raw = await readJsonBody(req);
    const parsed = validateBody(updateTaxRateSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { id, ...updates } = parsed.data;

    const expectedUpdatedAt = (parsed.data as Record<string, unknown>).expectedUpdatedAt ? new Date((parsed.data as Record<string, unknown>).expectedUpdatedAt as string) : null;
    const guard = await concurrencyGuard(db, taxRates, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const updateData = { ...updates, updatedAt: new Date() } as Record<string, unknown>;
    if (updateData.rate !== undefined) {
      updateData.rate = String(updateData.rate);
    }
    delete updateData.id;

    const [row] = await db.update(taxRates)
      .set(updateData as typeof taxRates.$inferInsert)
      .where(and(eq(taxRates.id, id), eq(taxRates.tenantId, ctx.tenantId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Tax rate not found' }, { status: 404 });
    }

    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

/**
 * DELETE /api/tenant/tax
 * Soft-delete a tax rate (sets isActive to false).
 * Module-gated to 'sales-quotes'.
 */
export const DELETE = withApiRoute(async (req: NextRequest) => {
  try {
  const limited = await rateLimitMutating(req, 'taxRates', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes', ctx.isSuperAdmin);
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Tax rate ID is required' }, { status: 400 });
    }

    const [row] = await db.update(taxRates)
      .set({ isActive: false, deletedAt: sql`now()`, deletedBy: ctx.userId, updatedAt: new Date() } as Record<string, unknown>)
      .where(and(eq(taxRates.id, id), eq(taxRates.tenantId, ctx.tenantId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Tax rate not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id: row.id, deleted: true } });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
