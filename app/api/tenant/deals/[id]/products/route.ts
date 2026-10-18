/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm, type AuthContext } from '@/lib/auth/middleware';
import { ownerScope } from '@/lib/api/owner-scope';
import { sumLineItems } from '@/lib/money';
import { db } from '@/drizzle/db';
import { deals, dealProducts } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

const createDealProductSchema = z.object({
  product_name: z.string().trim().min(1, 'Product name is required').max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  price: z.coerce.number().min(0).optional().default(0),
});

const updateDealProductSchema = createDealProductSchema.partial();

/**
 * The parent check `deals/[id]` applies to every verb, in one place. The owner
 * narrowing is what the old `assertDeal(tenantId, dealId)` left out: a row read on
 * `id + tenant_id + deleted_at` resolves for a `sales_rep` whose `deals.view_all` is
 * false (`lib/permissions/definitions.ts:135`), which is exactly the caller
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

// GET /api/tenant/deals/:id/products — list line items for a deal.
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

    const items = await db
      .select()
      .from(dealProducts)
      .where(and(eq(dealProducts.dealId, dealId), eq(dealProducts.tenantId, ctx.tenantId)))
      .orderBy(dealProducts.createdAt);

    // Also return the computed total so the UI can show it without re-summing.
    // round at each step (audit M-1) so repeated float addition cannot drift.
    const total = sumLineItems(
      items.map((i) => ({ quantity: i.quantity ?? 1, unit_price: i.price })),
    );

    return NextResponse.json({ data: items, total });
  } catch (err) { return apiError(err); }
});

// POST /api/tenant/deals/:id/products — add a line item.
export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'deal-products', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.edit');
    if (deny) return deny;
    const dealId = (await params).id;

    if (!(await assertDeal(ctx, dealId))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const body = await readJsonBody(req);
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
  } catch (err) { return apiError(err); }
});

// PATCH /api/tenant/deals/:id/products — update a line item (pass item_id in body).
export const PATCH = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'deal-products', 'patch');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.edit');
    if (deny) return deny;
    const dealId = (await params).id;

    // Without this the write was keyed on a deal id the caller chose, and nothing
    // asked whether that deal exists, is theirs, or is soft-deleted (#2709).
    if (!(await assertDeal(ctx, dealId))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const body = await readJsonBody(req);
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
  } catch (err) { return apiError(err); }
});

// DELETE /api/tenant/deals/:id/products?item_id=... — remove a line item.
export const DELETE = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const limited = await rateLimitMutating(req, 'deal-products', 'delete');
    if (limited) return limited;

    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.edit');
    if (deny) return deny;
    const dealId = (await params).id;

    if (!(await assertDeal(ctx, dealId))) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

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
  } catch (err) { return apiError(err); }
});
