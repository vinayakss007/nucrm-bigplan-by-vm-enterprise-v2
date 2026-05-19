import { NextRequest, NextResponse } from 'next/server';
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
      whereConditions.push(eq(orders.contactId, contactId as any));
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

    const body = await request.json();
    const { contactId, companyId, title, orderDate, expectedDeliveryDate, notes, customerNotes, items, subtotal, discountAmount, taxAmount, shippingAmount, shippingAddress, shippingCity, shippingState, shippingCountry, shippingPostalCode } = body;

    if (!orderDate) {
      return NextResponse.json({ error: 'Order date is required' }, { status: 400 });
    }

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(orders).where(eq(orders.tenantId, tenantId));
    const orderNumber = `ORD-${String((countResult[0]?.count ?? 0) + 1).padStart(5, '0')}`;

    const totalAmount = (parseFloat(subtotal) || 0) - (parseFloat(discountAmount) || 0) + (parseFloat(taxAmount) || 0) + (parseFloat(shippingAmount) || 0);

    const [order] = await db.insert(orders).values({
      tenantId,
      contactId: contactId ?? null,
      companyId: companyId ?? null,
      orderNumber,
      title: title ?? `Order ${orderNumber}`,
      status: 'draft',
      orderDate: new Date(orderDate).toISOString().split('T')[0],
      expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate).toISOString().split('T')[0] : null,
      subtotal: subtotal ? String(subtotal) : '0',
      discountAmount: discountAmount ? String(discountAmount) : '0',
      taxAmount: taxAmount ? String(taxAmount) : '0',
      shippingAmount: shippingAmount ? String(shippingAmount) : '0',
      totalAmount: String(totalAmount.toFixed(2)),
      shippingAddress: shippingAddress ?? null,
      shippingCity: shippingCity ?? null,
      shippingState: shippingState ?? null,
      shippingCountry: shippingCountry ?? null,
      shippingPostalCode: shippingPostalCode ?? null,
      notes: notes ?? null,
      customerNotes: customerNotes ?? null,
      createdBy: userId,
    } as any).returning();

    if (!order) throw new Error('Failed to create order');

    if (items?.length) {
      const lineItems = items.map((item: any, idx: number) => ({
        orderId: order.id,
        productId: item.productId || null,
        serviceId: item.serviceId || null,
        description: item.description,
        itemType: item.itemType || 'product',
        quantity: String(item.quantity || 1),
        unitPrice: String(item.unitPrice || 0),
        total: String(((parseFloat(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0)).toFixed(2)),
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