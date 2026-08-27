/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createQuoteSchema } from '@/lib/api/schemas';
import { parsePageLimit } from '@/lib/api/query-params';
import { sumLineItems, documentTotal, lineTotal } from '@/lib/money';
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
    const { page, limit, offset } = parsePageLimit(searchParams);

    const conditions: ReturnType<typeof eq>[] = [eq(quotes.tenantId, tenantId)];
    if (status) conditions.push(eq(quotes.status, status));
    if (contactId) conditions.push(eq(quotes.contactId, contactId));
    if (dealId) conditions.push(eq(quotes.dealId, dealId));
    const whereClause = and(...conditions);

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

    const rawBody = await readJsonBody(request);
    const validated = validateBody(createQuoteSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { contact_id: contactId, company_id: _companyId, title, line_items: items, notes, terms, discount, status, issue_date: _issueDate, expiry_date: expiryDate } = v;
    const tax = 0;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(quotes).where(eq(quotes.tenantId, tenantId));
    const quoteNumber = `QT-${String(Number(countResult[0]?.count ?? 0) + 1).padStart(5, '0')}`;

    const subtotal = items?.length ? sumLineItems(items) : 0;
    const totalAmount = documentTotal(subtotal, discount ?? 0, tax);

    const quote = await db.transaction(async (tx) => {
      const [q] = await tx.insert(quotes).values({
        tenantId,
        contactId: contactId || null,
        dealId: null,
        quoteNumber,
        title,
        status: status ?? 'draft',
        subtotal: subtotal.toFixed(2),
        discount: String(discount ?? 0),
        tax: String(tax),
        totalAmount: totalAmount.toFixed(2),
        expiresAt: expiryDate ? new Date(expiryDate) : null,
        notes,
        terms,
        createdBy: userId,
      }).returning();

      if (!q) throw new Error('Failed to create quote');

      if (items?.length) {
        const lineItems = items.map((item: { name?: string; description?: string | null; quantity?: number; unit_price?: number; product_id?: string | null; service_id?: string | null; item_type?: string | null; tax_amount?: number | null; discount_amount?: number | null; discount_percent?: number | null }, idx: number) => ({
          tenantId,
          quoteId: q.id,
          productId: item.product_id ?? null,
          serviceId: item.service_id ?? null,
          itemType: item.item_type ?? (item.service_id ? 'service' : 'product'),
          description: item.description ?? '',
          quantity: String(item.quantity ?? 1),
          unitPrice: String(item.unit_price ?? 0),
          discountPercent: '0',
          taxPercent: String(item.tax_amount ?? 0),
          total: lineTotal(item.quantity ?? 1, item.unit_price ?? 0).toFixed(2),
          sortOrder: idx,
        } as typeof quoteLineItems.$inferInsert));
        await tx.insert(quoteLineItems).values(lineItems as typeof quoteLineItems.$inferInsert[]);
      }

      return q;
    });

    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    console.error('[quotes/POST]', error);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
