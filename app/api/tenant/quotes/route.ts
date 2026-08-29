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
import { eq, and, desc, sql, count, isNull } from 'drizzle-orm';
import { requireAuth, requireModule } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';

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

    const conditions = [eq(quotes.tenantId, tenantId), isNull(quotes.deletedAt)];
    if (status) conditions.push(eq(quotes.status, status));
    if (contactId) conditions.push(eq(quotes.contactId, contactId));
    if (dealId) conditions.push(eq(quotes.dealId, dealId));
    const whereClause = and(...conditions);

    const results = await db.select().from(quotes).where(whereClause).orderBy(desc(quotes.createdAt)).limit(limit).offset(offset);

    const totalRes = await db.select({ count: count() }).from(quotes).where(and(eq(quotes.tenantId, tenantId), isNull(quotes.deletedAt)));
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
    const limited = await rateLimitMutating(request, 'quotes', 'post');
    if (limited) return limited;
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

    const subtotal = items?.length ? sumLineItems(items) : 0;
    const totalAmount = documentTotal(subtotal, discount ?? 0, tax);

    // #1611: Generate the quote number inside the transaction while holding a
    // row lock on the tenant, deriving it from MAX(sequence) (not COUNT(*)).
    // The old COUNT(*)+1 approach reused numbers after any delete, counted
    // soft-deleted rows, and was not concurrency-safe. Retry on the unique
    // constraint in case of a race despite the lock. Mirrors the invoice fix
    // (#1462) in app/api/tenant/invoices/route.ts.
    const MAX_RETRIES = 3;
    let quote: typeof quotes.$inferSelect | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        quote = await db.transaction(async (tx) => {
          // Serialize quote-number generation for this tenant.
          await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

          const [maxRow] = await tx.select({
            maxNum: sql<number>`COALESCE(MAX(
              CASE WHEN ${quotes.quoteNumber} ~ '^QT-[0-9]+$'
              THEN CAST(SUBSTRING(${quotes.quoteNumber} FROM 4) AS integer)
              ELSE 0 END
            ), 0)`
          }).from(quotes).where(and(eq(quotes.tenantId, tenantId), isNull(quotes.deletedAt)));

          const seq = ((maxRow?.maxNum as number) ?? 0) + 1;
          const quoteNumber = `QT-${String(seq).padStart(5, '0')}`;

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
        break; // success
      } catch (err: unknown) {
        const isUniqueViolation = err instanceof Error &&
          ((err as { code?: string }).code === '23505' || err.message.includes('unique'));
        if (isUniqueViolation && attempt < MAX_RETRIES - 1) continue;
        throw err;
      }
    }

    if (!quote) {
      return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
    }

    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    console.error('[quotes/POST]', error);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
