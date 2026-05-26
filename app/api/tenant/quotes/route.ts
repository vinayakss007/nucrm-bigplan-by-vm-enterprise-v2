import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { createQuoteSchema } from '@/lib/api/schemas';
import { db } from '@/drizzle/db';
import { quotes, quoteLineItems } from '@/drizzle/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { requireAuth, requireModule } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const modErr = await requireModule(ctx, 'sales-quotes');
    if (modErr) return modErr;

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

    const modErr = await requireModule(ctx, 'sales-quotes');
    if (modErr) return modErr;

    const { tenantId, userId } = ctx;

    const rawBody = await request.json();
    const validated = validateBody(createQuoteSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_id: contactId, company_id: companyId, title, line_items: items, notes, terms, discount, status, issue_date: issueDate, expiry_date: expiryDate } = v;
    const tax = 0;

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

    if (items?.length) {
      const lineItems = items.map((item: any, idx: number) => ({
        quoteId: (quote as any)[0].id,
        productId: null,
        description: item.description,
        quantity: String(item.quantity || 1),
        unitPrice: String(item.unit_price || 0),
        discountPercent: '0',
        taxPercent: String(item.tax_rate || 0),
        total: String(((parseFloat(item.quantity) || 1) * (parseFloat(item.unit_price) || 0)).toFixed(2)),
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
