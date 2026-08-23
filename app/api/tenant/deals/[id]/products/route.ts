/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { deals, dealProducts } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';

const createDealProductSchema = z.object({
  product_name: z.string().trim().min(1, 'Product name is required').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  price: z.coerce.number().min(0).optional().default(0),
});

const updateDealProductSchema = createDealProductSchema.partial();

async function assertDeal(tenantId: string, dealId: string) {
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId), sql`${deals.deletedAt} IS NULL`))
    .limit(1);
  return deal;
}

// GET /api/tenant/deals/:id/products — list line items for a deal.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const dealId = (await params).id;

    if (!(await assertDeal(ctx.tenantId, dealId))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const items = await db
      .select()
      .from(dealProducts)
      .where(and(eq(dealProducts.dealId, dealId), eq(dealProducts.tenantId, ctx.tenantId)))
      .orderBy(dealProducts.createdAt);

    // Also return the computed total so the UI can show it without re-summing.
    const total = items.reduce((sum, i) => sum + (Number(i.price) || 0) * (i.quantity ?? 1), 0);

    return NextResponse.json({ data: items, total });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

// POST /api/tenant/deals/:id/products — add a line item.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await rateLimitMutating(req, 'deal-products', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const dealId = (await params).id;

    if (!(await assertDeal(ctx.tenantId, dealId))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const body = await req.json();
    const validated = validateBody(createDealProductSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const [item] = await db.insert(dealProducts).values({
      tenantId: ctx.tenantId,
      dealId,
      productName: v.product_name,
      description: v.description ?? null,
      quantity: v.quantity,
      price: v.price.toString(),
    }).returning();

    return NextResponse.json({ data: item }, { status: 201 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

// PATCH /api/tenant/deals/:id/products — update a line item (pass item_id in body).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await rateLimitMutating(req, 'deal-products', 'patch');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const dealId = (await params).id;

    const body = await req.json();
    const itemId = body?.item_id;
    if (!itemId) return NextResponse.json({ error: 'item_id is required' }, { status: 400 });

    const validated = validateBody(updateDealProductSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = body?.expectedUpdatedAt ? new Date(body.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, dealProducts, itemId, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (v.product_name !== undefined) updates['productName'] = v.product_name;
    if (v.description !== undefined) updates['description'] = v.description;
    if (v.quantity !== undefined) updates['quantity'] = v.quantity;
    if (v.price !== undefined) updates['price'] = v.price.toString();

    const [updated] = await db.update(dealProducts)
      .set(updates)
      .where(and(
        eq(dealProducts.id, itemId),
        eq(dealProducts.dealId, dealId),
        eq(dealProducts.tenantId, ctx.tenantId),
      ))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    return NextResponse.json({ data: updated });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

// DELETE /api/tenant/deals/:id/products?item_id=... — remove a line item.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const limited = await rateLimitMutating(req, 'deal-products', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const dealId = (await params).id;

    const itemId = new URL(req.url).searchParams.get('item_id');
    if (!itemId) return NextResponse.json({ error: 'item_id query parameter is required' }, { status: 400 });

    const [deleted] = await db.update(dealProducts)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(dealProducts.id, itemId),
        eq(dealProducts.dealId, dealId),
        eq(dealProducts.tenantId, ctx.tenantId),
        isNull(dealProducts.deletedAt),
      ))
      .returning();

    if (!deleted) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    return NextResponse.json({ data: { id: itemId, deleted: true } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
