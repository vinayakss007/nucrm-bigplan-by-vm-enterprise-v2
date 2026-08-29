/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Convert a quote to an invoice
 * POST /api/tenant/quotes/[id]/convert-to-invoice
 * body: { due_date? }
 *
 * Creates a new invoice from the quote's line items and links them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes, quoteLineItems, invoices, invoiceLineItems, activities } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { logAudit } from '@/lib/audit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Quote ID required' }, { status: 400 });

    const quote = await db.query.quotes.findFirst({
      where: and(eq(quotes.id, id), eq(quotes.tenantId, ctx.tenantId), isNull(quotes.deletedAt)),
    });
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });

    // Check if already converted
    const existing = await db.query.invoices.findFirst({
      where: and(eq(invoices.quoteId, id), isNull(invoices.deletedAt)),
    });
    if (existing) {
      return NextResponse.json({ error: 'Quote already converted to invoice', invoiceId: existing.id }, { status: 409 });
    }

    let body: { due_date?: string };
    try { body = await readJsonBody(req) as { due_date?: string }; } catch { body = {}; }

    const dueDate = body.due_date ? body.due_date : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Copy line items before transaction (read-only)
    const items = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, id));

    // Generate invoice number (race-condition safe: derive MAX inside the
    // transaction while holding a row lock on the tenant)
    const MAX_RETRIES = 3;
    let invoice: Awaited<ReturnType<typeof db.query.invoices.findFirst>> | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Create invoice + line items + activity in a single transaction
        invoice = await db.transaction(async (tx) => {
          // Lock the tenant row to serialize invoice number generation
          await tx.execute(
            sql`SELECT id FROM tenants WHERE id = ${ctx.tenantId} FOR UPDATE`
          );

          const [maxRow] = await tx.select({
            maxNum: sql<number>`COALESCE(MAX(
              CASE WHEN ${invoices.invoiceNumber} ~ '^INV-[0-9]+$'
              THEN CAST(SUBSTRING(${invoices.invoiceNumber} FROM 5) AS integer)
              ELSE 0 END
            ), 0)`
          }).from(invoices).where(eq(invoices.tenantId, ctx.tenantId));

          const seq = ((maxRow?.maxNum as number) ?? 0) + 1;
          const invoiceNumber = `INV-${String(seq).padStart(5, '0')}`;

          const invoiceValues = {
            tenantId: ctx.tenantId,
            createdBy: ctx.userId,
            contactId: quote.contactId ?? undefined,
            companyId: undefined,
            invoiceNumber,
            title: quote.title,
            status: 'draft',
            issueDate: new Date().toISOString().slice(0, 10),
            dueDate,
            subtotal: quote.subtotal ?? '0',
            discountType: 'fixed',
            discountValue: quote.discount ?? '0',
            discountAmount: quote.discount ?? '0',
            taxRate: '0',
            taxAmount: quote.tax ?? '0',
            totalAmount: quote.totalAmount ?? '0',
            amountPaid: '0',
            balanceDue: quote.totalAmount ?? '0',
            quoteId: id,
            notes: quote.notes ?? undefined,
            terms: quote.terms ?? undefined,
          };
          const [inv] = await tx.insert(invoices).values([invoiceValues]).returning();

          if (!inv) {
            throw new Error('Failed to create invoice');
          }

          // Copy line items
          if (items.length > 0) {
            await tx.insert(invoiceLineItems).values(
              items.map((item, idx) => ({
                tenantId: ctx.tenantId,
                invoiceId: inv.id,
                productId: item.productId ?? undefined,
                serviceId: item.serviceId ?? undefined,
                description: item.description ?? '',
                itemType: item.itemType ?? (item.serviceId ? 'service' : 'product'),
                quantity: item.quantity ?? '1',
                unitPrice: item.unitPrice ?? '0',
                discountType: 'percentage' as const,
                discountValue: item.discountPercent ?? '0',
                discountAmount: '0',
                taxRate: item.taxPercent ?? '0',
                taxAmount: '0',
                total: item.total ?? '0',
                sortOrder: idx,
              }))
            );
          }

          // Activity
          try {
            await tx.insert(activities).values({
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              entityType: 'quote',
              entityId: id,
              contactId: quote.contactId,
              dealId: quote.dealId ?? null,
              eventType: 'quote_converted',
              description: `Quote "${quote.title}" converted to invoice ${invoiceNumber}`,
              metadata: { quote_id: id, invoice_id: inv.id, invoice_number: invoiceNumber },
            });
          } catch (err) {
            console.warn('[convert-to-invoice] activity insert failed:', (err as Error).message);
          }

          // Update the quote status to 'accepted'
          await tx.update(quotes).set({
            status: 'accepted',
            acceptedAt: new Date(),
            updatedAt: new Date(),
            updatedBy: ctx.userId,
          }).where(eq(quotes.id, id));

          return inv;
        });
        break; // success
      } catch (err: unknown) {
        const isUniqueViolation = err instanceof Error && ((err as { code?: string }).code === '23505' || err.message.includes('unique'));
        if (isUniqueViolation && attempt < MAX_RETRIES - 1) continue;
        throw err;
      }
    }

    if (!invoice) {
      return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'quote_converted_to_invoice',
      entityType: 'quote',
      entityId: id,
      newData: { invoice_id: invoice.id, invoice_number: (invoice as { invoiceNumber?: string }).invoiceNumber },
    });

    return NextResponse.json({
      ok: true,
      invoiceId: invoice.id,
      invoiceNumber: (invoice as { invoiceNumber?: string }).invoiceNumber,
      totalAmount: invoice.totalAmount,
    });
  } catch (err) {
    await logError({ error: err, context: 'tenant/quotes/[id]/convert-to-invoice POST', requestMethod: 'POST' });
    return apiError(err);
  }
});
