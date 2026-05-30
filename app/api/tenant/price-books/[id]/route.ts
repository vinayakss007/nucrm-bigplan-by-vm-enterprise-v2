import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { updatePriceBookSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { priceBooks } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;
    const { id } = await params;

    const [priceBook] = await db.select().from(priceBooks).where(
      and(eq(priceBooks.id, id), eq(priceBooks.tenantId, tenantId), isNull(priceBooks.deletedAt))
    );

    if (!priceBook) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: priceBook });
  } catch (error: any) {
    console.error('[price-books/[id]/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch price book' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const rawBody = await request.json();
    const validated = validateBody(updatePriceBookSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const updateData: any = { updatedAt: new Date(), updatedBy: userId };
    if (v.name !== undefined) updateData.name = v.name;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.currency !== undefined) updateData.currency = v.currency;
    if (v.is_active !== undefined) updateData.isActive = v.is_active;
    if (v.valid_from !== undefined) updateData.validFrom = v.valid_from;
    if (v.valid_until !== undefined) updateData.validUntil = v.valid_until;

    const [priceBook] = await db.update(priceBooks)
      .set(updateData)
      .where(and(eq(priceBooks.id, id), eq(priceBooks.tenantId, tenantId), isNull(priceBooks.deletedAt)))
      .returning();

    if (!priceBook) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: priceBook });
  } catch (error: any) {
    console.error('[price-books/[id]/PATCH]', error);
    return NextResponse.json({ error: 'Failed to update price book' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;
    const { id } = await params;

    const [priceBook] = await db.update(priceBooks)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(and(eq(priceBooks.id, id), eq(priceBooks.tenantId, tenantId), isNull(priceBooks.deletedAt)))
      .returning({ id: priceBooks.id });

    if (!priceBook) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('[price-books/[id]/DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete price book' }, { status: 500 });
  }
}
