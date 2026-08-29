/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createOrderSchema } from '@/lib/api/schemas';
import { parsePageLimit } from '@/lib/api/query-params';
import { db } from '@/drizzle/db';
import { orders, orderLineItems } from '@/drizzle/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'orders.view');
    if (deny) return deny;

    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const contactId = searchParams.get('contactId');
    const { page, limit, offset } = parsePageLimit(searchParams);

    const whereConditions = [eq(orders.tenantId, tenantId)];

    if (status) {
      whereConditions.push(eq(orders.status, status));
    }

    if (contactId) {
      whereConditions.push(eq(orders.contactId, contactId));
    }

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
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'orders', 'post');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'orders.create');
    if (deny) return deny;

    const { tenantId, userId } = ctx;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(createOrderSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_id: contactId, company_id: companyId, line_items: items, shipping_address: shippingAddress, tracking_number: _trackingNumber, notes, status } = v;

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

    const order = await db.transaction(async (tx) => {
      const [o] = await tx.insert(orders).values({
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

      if (!o) throw new Error('Failed to create order');

      if (items?.length) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lineItems = items.map((item: any, idx: number) => ({
          tenantId: ctx.tenantId,
          orderId: o.id,
          productId: null,
          serviceId: null,
          description: item.description,
          itemType: 'product',
          quantity: String(item.quantity || 1),
          unitPrice: String(item.unit_price || 0),
          total: String(((parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0)).toFixed(2)),
          sortOrder: idx,
        }));

        await tx.insert(orderLineItems).values(lineItems);
      }

      return o;
    });

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    console.error('[orders/POST]', error);
    return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
  }
});