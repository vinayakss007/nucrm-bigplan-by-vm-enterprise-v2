import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createQuoteSchema } from '@/lib/api/schemas';
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

    const conditions: ReturnType<typeof eq>[] = [eq(quotes.tenantId, tenantId)];
    if (status) conditions.push(eq(quotes.status, status));
    if (contactId) conditions.push(eq(quotes.contactId, contactId));
    if (dealId) conditions.push(eq(quotes.dealId, dealId));
    const whereClause = and(...conditions);

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

    const rawBody = await request.json();
    const validated = validateBody(createQuoteSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_id: contactId, company_id: _companyId, title, line_items: items, notes, terms, discount, status, issue_date: _issueDate, expiry_date: expiryDate } = v;
    const tax = 0;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(quotes).where(eq(quotes.tenantId, tenantId));
    const quoteNumber = `QT-${String(countResult[0]?.count ?? 0 + 1).padStart(5, '0')}`;

    let subtotal = 0;
    if (items?.length) {
      for (const item of items) {
        subtotal += (parseFloat(String(item.quantity)) || 1) * (parseFloat(String(item.unit_price)) || 0);
      }
    }
    const totalAmount = subtotal - (parseFloat(String(discount)) || 0) + (parseFloat(String(tax)) || 0);

    const [quote] = await db.insert(quotes).values({
      tenantId,
      contactId: contactId || null,
      dealId: null,
      quoteNumber,
      title,
      status: status ?? 'draft',
      subtotal: String(subtotal.toFixed(2)),
      discount: String(discount ?? 0),
      tax: String(tax),
      totalAmount: String(totalAmount.toFixed(2)),
      expiresAt: expiryDate ? new Date(expiryDate) : null,
      notes,
      terms,
      createdBy: userId,
    }).returning();

    if (!quote) throw new Error('Failed to create quote');

    if (items?.length) {
      const lineItems = items.map((item: { description?: string; quantity?: string | number; unit_price?: string | number; tax_rate?: string | number }, idx: number) => ({
        quoteId: quote.id,
        productId: null,
        description: item.description ?? '',
        quantity: String(item.quantity || 1),
        unitPrice: String(item.unit_price || 0),
        discountPercent: '0',
        taxPercent: String(item.tax_rate || 0),
        total: String(((parseFloat(String(item.quantity)) || 1) * (parseFloat(String(item.unit_price)) || 0)).toFixed(2)),
        sortOrder: idx,
      } as typeof quoteLineItems.$inferInsert));
      await db.insert(quoteLineItems).values(lineItems as typeof quoteLineItems.$inferInsert[]);
    }

    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    console.error('[quotes/POST]', error);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
