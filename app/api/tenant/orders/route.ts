import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createOrderSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { orders, orderLineItems } from '@/drizzle/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const contactId = searchParams.get('contactId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    const whereConditions = [eq(orders.tenantId, tenantId)];

    if (status) {
      whereConditions.push(eq(orders.status, status));
    }

    if (contactId) {
      whereConditions.push(eq(orders.contactId, contactId));
    }

    const offset = (page - 1) * limit;
    const results = await db.select().from(orders).where(and(...whereConditions)).orderBy(desc(orders.createdAt)).limit(limit).offset(offset);

    const [countResult] = await db.select({ count: count() }).from(orders).where(eq(orders.tenantId, tenantId));
    const total = countResult?.count ?? 0;

    return NextResponse.json({ 
      orders: results, 
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('[orders/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createOrderSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_id: contactId, company_id: companyId, line_items: items, shipping_address: shippingAddress, tracking_number: trackingNumber, notes, status } = v;

    if (!items?.length) {
      return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });
    }

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.tenantId, tenantId));
    const orderNumber = `ORD-${String((countResult[0]?.count ?? 0) + 1).padStart(5, '0')}`;

    let subtotal = 0;
    for (const item of items) {
      subtotal += (parseFloat(String(item.quantity)) || 1) * (parseFloat(String(item.unit_price)) || 0);
    }
    const totalAmount = subtotal;

    const [order] = await db.insert(orders).values({
      tenantId,
      contactId: contactId ?? null,
      companyId: companyId ?? null,
      orderNumber,
      title: `Order ${orderNumber}`,
      status: status ?? 'pending',
      orderDate: new Date().toISOString().split('T')[0],
      expectedDeliveryDate: null,
      subtotal: String(subtotal.toFixed(2)),
      discountAmount: '0',
      taxAmount: '0',
      shippingAmount: '0',
      totalAmount: String(totalAmount.toFixed(2)),
      shippingAddress: shippingAddress ?? null,
      shippingCity: null,
      shippingState: null,
      shippingCountry: null,
      shippingPostalCode: null,
      notes: notes ?? null,
      customerNotes: null,
      createdBy: userId,
    } as typeof orders.$inferInsert).returning();

    if (!order) throw new Error('Failed to create order');

    if (items?.length) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lineItems = items.map((item: any, idx: number) => ({
        orderId: order.id,
        productId: null,
        serviceId: null,
        description: item.description,
        itemType: 'product',
        quantity: String(item.quantity || 1),
        unitPrice: String(item.unit_price || 0),
        total: String(((parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0)).toFixed(2)),
        sortOrder: idx,
      }));

      await db.insert(orderLineItems).values(lineItems);
    }

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    console.error('[orders/POST]', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
}