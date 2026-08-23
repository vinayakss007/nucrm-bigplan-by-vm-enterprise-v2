/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Invoice PDF Export
 * GET /api/tenant/invoices/[id]/pdf
 * Returns an HTML document styled for print/PDF export
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { invoices, invoiceLineItems, contacts } from '@/drizzle/schema';
import { eq, and, sql, asc } from 'drizzle-orm';
import { escapeHtml } from '@/lib/email/escape-html';

function formatCurrency(amount: number | string | null): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function renderHTML(invoice: Record<string, unknown>, lineItems: Record<string, unknown>[], contactName: string): string {
  const subtotal = invoice.subtotal as string | number | null;
  const discountAmount = invoice.discountAmount as string | number | null;
  const taxAmount = invoice.taxAmount as string | number | null;
  const totalAmount = invoice.totalAmount as string | number | null;
  const balanceDue = invoice.balanceDue as string | number | null;
  const amountPaid = invoice.amountPaid as string | number | null;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${escapeHtml(String(invoice.invoiceNumber || ''))}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
    .header h1 { font-size: 28px; font-weight: 700; color: #111827; }
    .header .meta { text-align: right; font-size: 14px; color: #6b7280; }
    .header .meta .invoice-number { font-size: 18px; font-weight: 600; color: #111827; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .status-draft { background: #f3f4f6; color: #374151; }
    .status-sent { background: #dbeafe; color: #1d4ed8; }
    .status-paid { background: #d1fae5; color: #065f46; }
    .status-overdue { background: #fee2e2; color: #991b1b; }
    .status-cancelled { background: #f3f4f6; color: #6b7280; }
    .details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px; }
    .detail-group h3 { font-size: 12px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px; }
    .detail-group p { font-size: 14px; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; padding: 10px 12px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-size: 12px; text-transform: uppercase; color: #6b7280; }
    th:last-child, td:last-child { text-align: right; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
    .totals { display: flex; justify-content: flex-end; margin-bottom: 32px; }
    .totals-table { width: 280px; }
    .totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
    .totals-row.total { border-top: 2px solid #111827; padding-top: 10px; font-weight: 700; font-size: 18px; }
    .totals-row.balance { color: #dc2626; font-weight: 600; }
    .notes { margin-bottom: 32px; }
    .notes h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
    .notes p { font-size: 14px; color: #4b5563; white-space: pre-wrap; }
    .footer { border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 12px; color: #9ca3af; text-align: center; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Invoice</h1>
      <span class="status status-${escapeHtml(String(invoice.status))}">${escapeHtml(String(invoice.status))}</span>
    </div>
    <div class="meta">
      <div class="invoice-number">${escapeHtml(String(invoice.invoiceNumber || ''))}</div>
      <div>${escapeHtml(String(invoice.title))}</div>
      <div>Issued: ${new Date(invoice.issueDate as string).toLocaleDateString()}</div>
      ${invoice.dueDate ? `<div>Due: ${new Date(invoice.dueDate as string).toLocaleDateString()}</div>` : ''}
    </div>
  </div>

  <div class="details">
    <div class="detail-group">
      <h3>Bill To</h3>
      <p>${escapeHtml(contactName || 'N/A')}</p>
    </div>
    <div class="detail-group">
      <h3>Invoice Details</h3>
      <p>${escapeHtml(String(invoice.title))}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map(item => `
      <tr>
        <td>${escapeHtml(String(item.description))}</td>
        <td>${item.quantity}</td>
        <td>${formatCurrency(item.unitPrice as string | number | null)}</td>
        <td>${formatCurrency(item.total as string | number | null)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-table">
      <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
      ${parseFloat(String(discountAmount || 0)) > 0 ? `<div class="totals-row"><span>Discount</span><span>-${formatCurrency(discountAmount)}</span></div>` : ''}
      ${parseFloat(String(taxAmount || 0)) > 0 ? `<div class="totals-row"><span>Tax</span><span>${formatCurrency(taxAmount)}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span>${formatCurrency(totalAmount)}</span></div>
      ${parseFloat(String(amountPaid || 0)) > 0 ? `<div class="totals-row"><span>Paid</span><span>-${formatCurrency(amountPaid)}</span></div>` : ''}
      ${parseFloat(String(balanceDue || 0)) > 0 ? `<div class="totals-row balance"><span>Balance Due</span><span>${formatCurrency(balanceDue)}</span></div>` : ''}
    </div>
  </div>

  ${invoice.notes ? `<div class="notes"><h3>Notes</h3><p>${escapeHtml(String(invoice.notes))}</p></div>` : ''}
  ${invoice.terms ? `<div class="notes"><h3>Terms & Conditions</h3><p>${escapeHtml(String(invoice.terms))}</p></div>` : ''}
  ${invoice.footer ? `<div class="notes"><h3>Footer</h3><p>${escapeHtml(String(invoice.footer))}</p></div>` : ''}

  <div class="footer">Generated on ${new Date().toLocaleDateString()}</div>
</body>
</html>`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'invoices.view');
    if (deny) return deny;

    const invoiceId = (await params).id;

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
          sql`${invoices.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(asc(invoiceLineItems.sortOrder));

    let contactName = '';
    if (invoice.contactId) {
      const [contact] = await db
        .select({ name: contacts.firstName })
        .from(contacts)
        .where(eq(contacts.id, invoice.contactId))
        .limit(1);
      contactName = contact?.name || '';
    }

    const html = renderHTML(invoice, items, contactName);

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${String(invoice.invoiceNumber || 'invoice').replace(/[^a-zA-Z0-9_\-]/g, '_')}.html"`,
      },
    });
  } catch (err) {
    console.error('[invoices [id] pdf GET]', err);
    return apiError(err);
  }
}
