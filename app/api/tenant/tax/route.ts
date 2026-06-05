import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { db } from '@/drizzle/db';
import { taxRates } from '@/drizzle/schema/financial';
import { eq, and, sql } from 'drizzle-orm';

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

    const body = await req.json();
    const { name, rate, type, country, state, isDefault } = body;

    if (!name || rate === undefined || rate === null) {
      return NextResponse.json(
        { error: 'Name and rate are required' },
        { status: 400 }
      );
    }

    if (type && !['percentage', 'fixed'].includes(type)) {
      return NextResponse.json(
        { error: "Type must be 'percentage' or 'fixed'" },
        { status: 400 }
      );
    }

    const [row] = await db.insert(taxRates).values({
      tenantId: ctx.tenantId,
      name,
      rate: String(rate),
      type: type || 'percentage',
      country: country || null,
      state: state || null,
      isDefault: isDefault || false,
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

    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Tax rate ID is required' }, { status: 400 });
    }

    if (updates.rate !== undefined) {
      updates.rate = String(updates.rate);
    }

    const [row] = await db.update(taxRates)
      .set(updates)
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
