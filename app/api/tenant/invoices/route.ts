/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateBody, validateQuery, readJsonBody } from '@/lib/api/validate';
import { createInvoiceSchema, invoiceQuerySchema } from '@/lib/api/schemas';
import { sumLineItems, lineTotal, money, round2 } from '@/lib/money';
import { db } from '@/drizzle/db';
import { invoices, invoiceLineItems } from '@/drizzle/schema';
import { eq, and, desc, sql, count, isNull } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/middleware';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId } = ctx;

    const { searchParams } = new URL(request.url);
    const qParams = Object.fromEntries(searchParams.entries());
    const qValidated = validateQuery(invoiceQuerySchema, qParams);
    // Surface invalid pagination params instead of silently falling back to
    // defaults (which hides client bugs and returns unexpected result sets).
    if (qValidated instanceof NextResponse) return qValidated;
    const q = qValidated.data;
    const status = searchParams.get('status');
    const contactId = searchParams.get('contactId');
    const _search = searchParams.get('search');
    const page = Math.floor(q.offset / q.limit) + 1;
    const limit = q.limit;

    const whereConditions = [eq(invoices.tenantId, tenantId), isNull(invoices.deletedAt)];

    if (status) {
      whereConditions.push(eq(invoices.status, status));
    }

    if (contactId) {
      whereConditions.push(eq(invoices.contactId, contactId));
    }

    const offset = (page - 1) * limit;
    const results = await db.select().from(invoices).where(and(...whereConditions)).orderBy(desc(invoices.createdAt)).limit(limit).offset(offset);

    // Count must apply the SAME filters as the results query, otherwise
    // pagination totals are wrong whenever a status/contactId filter is set.
    const [countResult] = await db.select({ count: count() }).from(invoices).where(and(...whereConditions));
    const total = countResult?.count ?? 0;

    // Standard list envelope: { data, total, page, limit, totalPages }.
    // The frontend and SDK read `data`; returning `invoices` here left the
    // invoices page permanently empty.
    return NextResponse.json({
      data: results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('[invoices/GET]', error);
    return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 });
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'invoices', 'post');
    if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { tenantId, userId } = ctx;

    const rawBody = await readJsonBody(request);
    const validated = validateBody(createInvoiceSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const { issue_date: issueDate, due_date: dueDate, line_items: items, notes, terms, discount, tax_rate: taxRate, contact_id: contactId, company_id: companyId, status } = v;
    const title = rawBody.title as string | undefined;
    const discountType = (rawBody.discount_type as string) || (v as Record<string, unknown>).discount_type as string | undefined;

    if (!issueDate) {
      return NextResponse.json({ error: 'Issue date is required' }, { status: 400 });
    }

    // Calculate totals
    const subtotal = items?.length ? sumLineItems(items) : 0;

    const rawDiscount = money(discount ?? 0);
    let discountAmount: number;
    let resolvedDiscountType: string;

    if (discountType === 'percentage' && rawDiscount > 0) {
      resolvedDiscountType = 'percentage';
      discountAmount = round2(subtotal * rawDiscount / 100);
    } else {
      resolvedDiscountType = rawDiscount > 0 ? 'fixed' : 'percentage';
      discountAmount = round2(rawDiscount);
    }

    const taxableAmount = round2(subtotal - discountAmount);
    const resolvedTaxRate = money(taxRate ?? 0);
    const taxAmount = round2(resolvedTaxRate / 100 * taxableAmount);
    const totalAmount = round2(taxableAmount + taxAmount);

    // #1462: Generate the invoice number inside the transaction while holding a
    // row lock on the tenant, deriving it from MAX(sequence) (not COUNT(*)). The
    // old COUNT(*)+1 approach reused numbers after any delete, counted
    // soft-deleted rows, and was not concurrency-safe. Retry on the unique
    // constraint in case of a race despite the lock.
    const MAX_RETRIES = 3;
    let invoice: typeof invoices.$inferSelect | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        invoice = await db.transaction(async (tx) => {
          // Serialize invoice-number generation for this tenant.
          await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

          const [maxRow] = await tx.select({
            maxNum: sql<number>`COALESCE(MAX(
              CASE WHEN ${invoices.invoiceNumber} ~ '^INV-[0-9]+$'
              THEN CAST(SUBSTRING(${invoices.invoiceNumber} FROM 5) AS integer)
              ELSE 0 END
            ), 0)`
          }).from(invoices).where(eq(invoices.tenantId, tenantId));

          const seq = ((maxRow?.maxNum as number) ?? 0) + 1;
          const invoiceNumber = `INV-${String(seq).padStart(5, '0')}`;

          const [inv] = await tx.insert(invoices).values({
            tenantId,
            contactId: contactId ?? null,
            companyId: companyId ?? null,
            invoiceNumber,
            title: title ?? `Invoice ${invoiceNumber}`,
            status: status ?? 'draft',
            issueDate: new Date(issueDate).toISOString().split('T')[0],
            dueDate: dueDate ? new Date(dueDate).toISOString().split('T')[0] : null,
            subtotal: subtotal.toFixed(2),
            discountType: resolvedDiscountType,
            discountValue: String(rawDiscount),
            discountAmount: discountAmount.toFixed(2),
            taxRate: String(taxRate),
            taxAmount: taxAmount.toFixed(2),
            totalAmount: totalAmount.toFixed(2),
            amountPaid: '0',
            balanceDue: totalAmount.toFixed(2),
            notes: notes ?? null,
            terms: terms ?? null,
            createdBy: userId,
          } as typeof invoices.$inferInsert).returning();

          if (!inv) throw new Error('Failed to create invoice');

          // Add line items
          if (items?.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lineItems = items.map((item: any, idx: number) => {
              // Money-math correctness (#1497): use rounded money helpers and
              const base = lineTotal(item.quantity ?? 1, item.unit_price ?? 0);
              const lineTaxRate = money(item.tax_rate ?? 0);
              const lineTax = round2(base * lineTaxRate / 100);
              return {
                tenantId: ctx.tenantId,
                invoiceId: inv.id,
                productId: null,
                serviceId: null,
                description: item.description,
                itemType: 'custom',
                quantity: String(item.quantity || 1),
                unitPrice: String(item.unit_price || 0),
                discountType: 'percentage',
                discountValue: '0',
                discountAmount: '0',
                taxRate: String(item.tax_rate || 0),
                // L-1: persist the per-line tax instead of a hard-coded '0' so
                // line-item sums reconcile with the invoice header.
                taxAmount: lineTax.toFixed(2),
                total: base.toFixed(2),
                sortOrder: idx,
              };
            });

            await tx.insert(invoiceLineItems).values(lineItems);
          }

          return inv;
        });
        break; // success
      } catch (err: unknown) {
        const isUniqueViolation = err instanceof Error &&
          ((err as { code?: string }).code === '23505' || err.message.includes('unique'));
        if (isUniqueViolation && attempt < MAX_RETRIES - 1) continue;
        throw err;
      }
    }

    if (!invoice) {
      return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
    }

    return NextResponse.json({ data: invoice }, { status: 201 });
  } catch (error) {
    console.error('[invoices/POST]', error);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
});