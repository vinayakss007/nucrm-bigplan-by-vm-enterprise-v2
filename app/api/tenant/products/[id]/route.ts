import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { updateProductSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { products } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;
    const { id } = await params;

    const [product] = await db.select().from(products).where(
      and(eq(products.id, id), eq(products.tenantId, tenantId), isNull(products.deletedAt))
    );

    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: product });
  } catch (error: any) {
    console.error('[products/[id]/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch product' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const rawBody = await request.json();
    const validated = validateBody(updateProductSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: any = { updatedAt: new Date(), updatedBy: userId };
    if (v.name !== undefined) updateData.name = v.name;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.sku !== undefined) updateData.sku = v.sku;
    if (v.price !== undefined) updateData.basePrice = String(v.price);

    const [product] = await db.update(products)
      .set(updateData)
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .returning();

    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: product });
  } catch (error: any) {
    console.error('[products/[id]/PATCH]', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const [product] = await db.update(products)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId), isNull(products.deletedAt)))
      .returning({ id: products.id });

    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[products/[id]/DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
  }
}
