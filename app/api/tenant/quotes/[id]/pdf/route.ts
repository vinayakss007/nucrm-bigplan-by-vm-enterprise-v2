/**
 * Quote PDF Export
 * GET /api/tenant/quotes/[id]/pdf
 * Returns an HTML document styled for print/PDF export
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes, quoteLineItems, contacts } from '@/drizzle/schema';
import { eq, and, sql, asc } from 'drizzle-orm';

function formatCurrency(amount: number | string | null): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function renderHTML(quote: Record<string, unknown>, lineItems: Record<string, unknown>[], contactName: string): string {
  const subtotal = quote.subtotal as string | number | null;
  const discount = quote.discount as string | number | null;
  const tax = quote.tax as string | number | null;
  const totalAmount = quote.totalAmount as string | number | null;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Quote ${quote.quoteNumber || ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
    .header h1 { font-size: 28px; font-weight: 700; color: #111827; }
    .header .meta { text-align: right; font-size: 14px; color: #6b7280; }
    .header .meta .quote-number { font-size: 18px; font-weight: 600; color: #111827; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .status-draft { background: #f3f4f6; color: #374151; }
    .status-sent { background: #dbeafe; color: #1d4ed8; }
    .status-accepted { background: #d1fae5; color: #065f46; }
    .status-declined { background: #fee2e2; color: #991b1b; }
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
      <h1>Quote</h1>
      <span class="status status-${quote.status}">${quote.status}</span>
    </div>
    <div class="meta">
      <div class="quote-number">${quote.quoteNumber || ''}</div>
      <div>${quote.title}</div>
      <div>Date: ${new Date(quote.createdAt as string).toLocaleDateString()}</div>
      ${quote.expiresAt ? `<div>Expires: ${new Date(quote.expiresAt as string).toLocaleDateString()}</div>` : ''}
    </div>
  </div>

  <div class="details">
    <div class="detail-group">
      <h3>Bill To</h3>
      <p>${contactName || 'N/A'}</p>
    </div>
    <div class="detail-group">
      <h3>Quote Details</h3>
      <p>${quote.title}</p>
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
        <td>${item.description}</td>
        <td>${item.quantity}</td>
        <td>${formatCurrency(item.unitPrice as string | number | null)}</td>
        <td>${formatCurrency(item.total as string | number | null)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-table">
      <div class="totals-row"><span>Subtotal</span><span>${formatCurrency(subtotal)}</span></div>
      ${parseFloat(String(discount || 0)) > 0 ? `<div class="totals-row"><span>Discount</span><span>-${formatCurrency(discount)}</span></div>` : ''}
      ${parseFloat(String(tax || 0)) > 0 ? `<div class="totals-row"><span>Tax</span><span>${formatCurrency(tax)}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span>${formatCurrency(totalAmount)}</span></div>
    </div>
  </div>

  ${quote.notes ? `<div class="notes"><h3>Notes</h3><p>${quote.notes}</p></div>` : ''}
  ${quote.terms ? `<div class="notes"><h3>Terms & Conditions</h3><p>${quote.terms}</p></div>` : ''}

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
    if (!can(ctx, 'quotes.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const quoteId = (await params).id;

    const [quote] = await db
      .select()
      .from(quotes)
      .where(
        and(
          eq(quotes.id, quoteId),
          eq(quotes.tenantId, ctx.tenantId),
          sql`${quotes.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const items = await db
      .select()
      .from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, quoteId))
      .orderBy(asc(quoteLineItems.sortOrder));

    let contactName = '';
    if (quote.contactId) {
      const [contact] = await db
        .select({ name: contacts.firstName })
        .from(contacts)
        .where(eq(contacts.id, quote.contactId))
        .limit(1);
      contactName = contact?.name || '';
    }

    const html = renderHTML(quote, items, contactName);

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${quote.quoteNumber || 'quote'}.html"`,
      },
    });
  } catch (err) {
    console.error('[quotes [id] pdf GET]', err);
    return apiError(err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function can(ctx: any, perm: string): boolean {
  return ctx.isAdmin || ctx.permissions?.['all'] || ctx.permissions?.[perm];
}
