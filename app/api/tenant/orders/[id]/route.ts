import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { orders } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';

// Order status state machine - defines valid transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [], // terminal state
  cancelled: [], // terminal state
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'orders.view');
    if (deny) return deny;

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[orders [id] GET]', err);
    return apiError(err);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'orders.edit');
    if (deny) return deny;

    const orderId = (await params).id;
    const body = await req.json();

    // Validate numeric fields
    const numericFields = ['totalAmount', 'subtotal', 'discount'] as const;
    for (const field of numericFields) {
      if (body[field] !== undefined) {
        const v = parseFloat(body[field]);
        if (isNaN(v)) {
          return NextResponse.json({ error: `${field} must be a valid number` }, { status: 400 });
        }
        body[field] = v;
      }
    }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allowedFields: Record<string, any> = {};
    const mutable = ['title', 'status', 'expectedDeliveryDate', 'shippingAddress', 'shippingCity', 'shippingState', 'shippingCountry', 'shippingPostalCode', 'trackingNumber', 'shippingCarrier', 'notes', 'customerNotes'] as const;
    for (const key of mutable) {
      if (body[key] !== undefined) allowedFields[key] = body[key];
    }

    // If status is being changed, validate the transition
    if (body.status) {
      const [current] = await db
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(
          and(
            eq(orders.id, orderId),
            eq(orders.tenantId, ctx.tenantId),
            sql`${orders.deletedAt} IS NULL`
          )
        )
        .limit(1);

      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const currentStatus = current.status || 'pending';
      const allowed = VALID_TRANSITIONS[currentStatus];

      if (allowed && !allowed.includes(body.status)) {
        const validOptions = allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
        return NextResponse.json(
          { error: `Invalid status transition from '${currentStatus}' to '${body.status}'. Valid transitions from '${currentStatus}': ${validOptions}` },
          { status: 400 }
        );
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
    }

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // If we haven't already fetched the existing record (no status change), check existence
    if (!body.status) {
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
    }

    const [updated] = await db
      .update(orders)
      .set({
        ...allowedFields,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(orders.id, orderId), eq(orders.tenantId, ctx.tenantId)))
      .returning();

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'order.updated',
      entityType: 'order',
      entityId: orderId,
      metadata: { changes: allowedFields },
    });

    return NextResponse.json({ data: updated });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[orders [id] PUT]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'orders.delete');
    if (deny) return deny;

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

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'order.deleted',
      entityType: 'order',
      entityId: orderId,
    });

    return NextResponse.json({ data: { id: row.id, deleted: true } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[orders [id] DELETE]', err);
    return apiError(err);
  }
}
