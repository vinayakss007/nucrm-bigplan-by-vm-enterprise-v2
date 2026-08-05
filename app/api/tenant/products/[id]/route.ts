import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { products } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { withConcurrencyGuard } from '@/lib/concurrency';
import { updatedAtMs } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { apiError } from '@/lib/api-error';

type RouteContext = { params: Promise<{ id: string }> };

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  sku: z.string().trim().max(100).nullable().optional(),
  base_price: z.coerce.number().min(0).optional(),
});

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const product = await db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)),
    });

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: product.id,
      name: product.name,
      description: product.description,
      sku: product.sku,
      base_price: product.basePrice,
      created_at: product.createdAt,
      updated_at: product.updatedAt,
    });
  } catch (error) {
    console.error('[products GET by id]', error);
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
  const limited = await rateLimitMutating(request, 'contacts', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const existing = await db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)),
      columns: { id: true, updatedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(updateProductSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (v.name !== undefined) updateData.name = v.name;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.sku !== undefined) updateData.sku = v.sku;
    if (v.base_price !== undefined) updateData.basePrice = String(v.base_price);

    const [updated] = await withConcurrencyGuard(
      () => db.update(products)
        .set(updateData)
        .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt), updatedAtMs(products, existing.updatedAt!)))
        .returning(),
      'Product',
      existing.updatedAt!,
    );

    logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update', entityType: 'product', entityId: id,
      newData: updateData,
    });

    fireWebhooks(ctx.tenantId, 'product.updated', { id }).catch(e => logError({ error: e, context: "async-catch:[context]" }));

    if (!updated) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      sku: updated.sku,
      base_price: updated.basePrice,
      created_at: updated.createdAt,
      updated_at: updated.updatedAt,
    });
  } catch (error) {
    console.error('[products PATCH]', error);
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
  const limited = await rateLimitMutating(request, 'contacts', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    const [deleted] = await db.update(products)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(and(eq(products.id, id), eq(products.tenantId, ctx.tenantId), isNull(products.deletedAt)))
      .returning({ id: products.id });

    if (!deleted) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'delete', entityType: 'product', entityId: id,
    });

    fireWebhooks(ctx.tenantId, 'product.deleted', { id }).catch(e => logError({ error: e, context: "async-catch:[context]" }));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[products DELETE]', error);
    return apiError(error);
  }
}
