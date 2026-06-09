import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { taxRates } from '@/drizzle/schema/financial';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const createTaxRateSchema = z.object({
  name: z.string().min(1, 'name is required'),
  rate: z.number().min(0, 'rate is required'),
  type: z.enum(['percentage', 'fixed']).optional().default('percentage'),
  country: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});

const updateTaxRateSchema = z.object({
  id: z.string().uuid('Tax rate ID is required'),
  name: z.string().optional(),
  rate: z.number().min(0).optional(),
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
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes');
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const country = searchParams.get('country');
    const state = searchParams.get('state');
    const activeOnly = searchParams.get('active') !== 'false';

    const filters: any[] = [eq(taxRates.tenantId, ctx.tenantId)];
    if (activeOnly) filters.push(eq(taxRates.isActive, true));
    if (country) filters.push(eq(taxRates.country, country));
    if (state) filters.push(eq(taxRates.state, state));

    const rates = await db.select().from(taxRates).where(and(...filters));

    return NextResponse.json({ data: rates, total: rates.length });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/tax
 * Create a new tax rate.
 * Module-gated to 'sales-quotes'.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes');
    if (gate) return gate;

    const raw = await req.json();
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
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * PUT /api/tenant/tax
 * Update a tax rate.
 * Module-gated to 'sales-quotes'.
 */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes');
    if (gate) return gate;

    const raw = await req.json();
    const parsed = validateBody(updateTaxRateSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { id, ...updates } = parsed.data;

    if ((updates as any).rate !== undefined) {
      (updates as any).rate = String((updates as any).rate);
    }
    delete (updates as any).id;

    const [row] = await db.update(taxRates)
      .set(updates as any)
      .where(and(eq(taxRates.id, id), eq(taxRates.tenantId, ctx.tenantId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Tax rate not found' }, { status: 404 });
    }

    return NextResponse.json({ data: row });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * DELETE /api/tenant/tax
 * Soft-delete a tax rate (sets isActive to false).
 * Module-gated to 'sales-quotes'.
 */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes');
    if (gate) return gate;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Tax rate ID is required' }, { status: 400 });
    }

    const [row] = await db.update(taxRates)
      .set({ isActive: false, deletedAt: sql`now()` })
      .where(and(eq(taxRates.id, id), eq(taxRates.tenantId, ctx.tenantId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: 'Tax rate not found' }, { status: 404 });
    }

    return NextResponse.json({ data: { id: row.id, deleted: true } });
  } catch (err: any) {
    return apiError(err);
  }
}
