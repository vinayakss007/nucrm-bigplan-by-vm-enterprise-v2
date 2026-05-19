import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { quotes, quoteLineItems } from '@/drizzle/schema';
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
    const dealId = searchParams.get('dealId');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    let whereClause = eq(quotes.tenantId, tenantId);
    if (status) whereClause = and(whereClause, eq(quotes.status, status)) as any;
    if (contactId) whereClause = and(whereClause, eq(quotes.contactId, contactId as any)) as any;
    if (dealId) whereClause = and(whereClause, eq(quotes.dealId, dealId as any)) as any;

    const offset = (page - 1) * limit;
    const results = await db.select().from(quotes).where(whereClause).orderBy(desc(quotes.createdAt)).limit(limit).offset(offset);

    const totalRes = await db.select({ count: count() }).from(quotes).where(eq(quotes.tenantId, tenantId));
    const total = totalRes[0]?.count ?? 0;

    return NextResponse.json({
      quotes: results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('[quotes/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const body = await request.json();
    const { contactId, dealId, title, expiresAt, notes, terms, items, discount, tax } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(quotes).where(eq(quotes.tenantId, tenantId));
    const quoteNumber = `QT-${String(countResult[0]?.count ?? 0 + 1).padStart(5, '0')}`;

    let subtotal = 0;
    if (items?.length) {
      for (const item of items) {
        subtotal += (parseFloat(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0);
      }
    }
    const totalAmount = subtotal - (parseFloat(discount) || 0) + (parseFloat(tax) || 0);

    const [quote] = await db.insert(quotes).values({
      tenantId,
      contactId: contactId || null,
      dealId: dealId || null,
      quoteNumber,
      title,
      status: 'draft',
      subtotal: String(subtotal.toFixed(2)),
      discount: discount ? String(discount) : '0',
      tax: tax ? String(tax) : '0',
      totalAmount: String(totalAmount.toFixed(2)),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      notes,
      terms,
      createdBy: userId,
    }).returning();

    if (items?.length) {
      const lineItems = items.map((item: any, idx: number) => ({
        quoteId: (quote as any)[0].id,
        productId: item.productId || null,
        description: item.description,
        quantity: String(item.quantity || 1),
        unitPrice: String(item.unitPrice || 0),
        discountPercent: item.discountPercent ? String(item.discountPercent) : '0',
        taxPercent: item.taxPercent ? String(item.taxPercent) : '0',
        total: String(((parseFloat(item.quantity) || 1) * (parseFloat(item.unitPrice) || 0)).toFixed(2)),
        sortOrder: idx,
      }));
      await db.insert(quoteLineItems).values(lineItems);
    }

    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    console.error('[quotes/POST]', error);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
