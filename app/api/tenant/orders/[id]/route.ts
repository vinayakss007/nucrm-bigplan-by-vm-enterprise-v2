import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { orders } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const orderId = (await params).id;

    const [row] = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.tenantId, ctx.tenantId),
          sql`${orders.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
  } catch (err: any) {
    console.error('[orders [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const orderId = (await params).id;
    const body = await req.json();

    const allowedFields: Record<string, any> = {};
    const mutable = ['title', 'status', 'expectedDeliveryDate', 'shippingAddress', 'shippingCity', 'shippingState', 'shippingCountry', 'shippingPostalCode', 'trackingNumber', 'shippingCarrier', 'notes', 'customerNotes'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    // Handle status-specific timestamp updates
    if (body.status === 'shipped' && !body.shippedAt) {
      allowedFields['shippedAt'] = new Date();
    }
    if (body.status === 'delivered' && !body.deliveredAt) {
      allowedFields['deliveredAt'] = new Date();
    }
    if (body.status === 'cancelled' && !body.cancelledAt) {
      allowedFields['cancelledAt'] = new Date();
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const [existing] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.tenantId, ctx.tenantId),
          sql`${orders.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [updated] = await db
      .update(orders)
      .set({
        ...allowedFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenantId)))
      .returning();

    return NextResponse.json({ data: updated });
  } catch (err: any) {
    console.error('[orders [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const orderId = (await params).id;

    const [row] = await db
      .update(orders)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.tenantId, ctx.tenantId),
          sql`${orders.deletedAt} IS NULL`
        )
      )
      .returning({ id: orders.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: { id: row.id, deleted: true } });
  } catch (err: any) {
    console.error('[orders [id] DELETE]', err);
    return apiError(err);
  }
}
