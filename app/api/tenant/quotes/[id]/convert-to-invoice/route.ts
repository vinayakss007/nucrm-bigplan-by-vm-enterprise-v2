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
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    try { body = await req.json() as { due_date?: string }; } catch { body = {}; }

    const dueDate = body.due_date ? new Date(body.due_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Generate invoice number
    const [countRow] = await db.select({ count: db.fn.count() }).from(invoices).where(eq(invoices.tenantId, ctx.tenantId));
    const seq = ((countRow?.count as number) ?? 0) + 1;
    const invoiceNumber = `INV-${String(seq).padStart(5, '0')}`;

    // Create invoice
    const [invoice] = await db.insert(invoices).values({
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      contactId: quote.contactId,
      companyId: null,
      invoiceNumber,
      title: quote.title,
      status: 'draft',
      issueDate: new Date(),
      dueDate,
      subtotal: quote.subtotal,
      discountType: 'fixed',
      discountValue: quote.discount,
      discountAmount: quote.discount,
      taxRate: 0,
      taxAmount: quote.tax,
      totalAmount: quote.totalAmount,
      amountPaid: 0,
      balanceDue: quote.totalAmount,
      quoteId: id,
      notes: quote.notes,
      terms: quote.terms,
    }).returning();

    if (!invoice) {
      return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
    }

    // Copy line items
    const items = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, id));
    if (items.length > 0) {
      await db.insert(invoiceLineItems).values(
        items.map((item, idx) => ({
          invoiceId: invoice.id,
          productId: item.productId,
          description: item.description,
          itemType: 'product',
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountType: 'percentage' as const,
          discountValue: item.discountPercent,
          discountAmount: 0,
          taxRate: item.taxPercent,
          taxAmount: 0,
          total: item.total,
          sortOrder: idx,
        }))
      );
    }

    // Activity
    try {
      await db.insert(activities).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entityType: 'quote',
        entityId: id,
        contactId: quote.contactId,
        dealId: quote.dealId ?? null,
        eventType: 'quote_converted',
        description: `Quote "${quote.title}" converted to invoice ${invoiceNumber}`,
        metadata: { quote_id: id, invoice_id: invoice.id, invoice_number: invoiceNumber },
      });
    } catch (err) {
      console.warn('[convert-to-invoice] activity insert failed:', (err as Error).message);
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'quote_converted_to_invoice',
      entityType: 'quote',
      entityId: id,
      newData: { invoice_id: invoice.id, invoice_number: invoiceNumber },
    });

    return NextResponse.json({
      ok: true,
      invoiceId: invoice.id,
      invoiceNumber,
      totalAmount: invoice.totalAmount,
    });
  } catch (err) {
    console.error('[convert-to-invoice POST]', err);
    return apiError(err);
  }
}
