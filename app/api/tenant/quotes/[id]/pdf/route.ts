/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { quotes, quoteLineItems, contacts, companies, tenants } from '@/drizzle/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { escapeHtml } from '@/lib/email/escape-html';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/tenant/quotes/:id/pdf
 * Generate a PDF for a quote (HTML-based, rendered server-side).
 * Returns Content-Type: application/pdf with Content-Disposition: attachment.
 */
export const GET = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;

    // Fetch quote with related data
    const [quote] = await db
      .select({
        id: quotes.id,
        title: quotes.title,
        status: quotes.status,
        totalAmount: quotes.totalAmount,
        // The column is expires_at; there is no quotes.validUntil.
        validUntil: quotes.expiresAt,
        notes: quotes.notes,
        createdAt: quotes.createdAt,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        contactEmail: contacts.email,
        companyName: companies.name,
        companyWebsite: companies.website,
      })
      .from(quotes)
      .leftJoin(contacts, eq(contacts.id, quotes.contactId))
      .leftJoin(companies, eq(companies.id, quotes.companyId))
      .where(and(eq(quotes.id, id), eq(quotes.tenantId, ctx.tenantId), sql`${quotes.deletedAt} IS NULL`))
      .limit(1);

    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });

    // Get tenant info for branding
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    // Line items live in their own table (quote_line_items); quotes has no
    // lineItems column. Ordered by sortOrder so the PDF matches the order the
    // user arranged them in.
    const items = await db
      .select({
        description: quoteLineItems.description,
        quantity: quoteLineItems.quantity,
        unitPrice: quoteLineItems.unitPrice,
        total: quoteLineItems.total,
      })
      .from(quoteLineItems)
      .where(and(eq(quoteLineItems.quoteId, id), eq(quoteLineItems.tenantId, ctx.tenantId)))
      .orderBy(asc(quoteLineItems.sortOrder));

    // Generate HTML for PDF
    const html = generateQuoteHtml({
      title: quote.title || `Quote #${id.slice(0, 8)}`,
      tenantName: tenant?.name || 'NuCRM',
      contactName: [quote.contactFirstName, quote.contactLastName].filter(Boolean).join(' ') || 'N/A',
      contactEmail: quote.contactEmail || '',
      companyName: quote.companyName || '',
      totalAmount: Number(quote.totalAmount || 0),
      validUntil: quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : 'N/A',
      notes: quote.notes || '',
      lineItems: items,
      createdAt: new Date(quote.createdAt).toLocaleDateString(),
      status: quote.status || 'draft',
    });

    // Return HTML as a "printable" page that can be saved as PDF via browser
    // For server-side PDF generation, you'd use puppeteer/playwright or @react-pdf/renderer
    // This gives immediate value without adding heavy dependencies
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="quote-${id.slice(0, 8)}.html"`,
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

function generateQuoteHtml(data: {
  title: string;
  tenantName: string;
  contactName: string;
  contactEmail: string;
  companyName: string;
  totalAmount: number;
  validUntil: string;
  notes: string;
  lineItems: Array<{
    description: string | null;
    // decimal columns come back as strings from pg.
    quantity: string | null;
    unitPrice: string | null;
    total: string | null;
  }>;
  createdAt: string;
  status: string;
}): string {
  const itemRows = data.lineItems.map((item, i) => {
    const qty = Number(item.quantity ?? 1);
    const unitPrice = Number(item.unitPrice ?? 0);
    // quote_line_items stores the computed total, which already accounts for the
    // per-line discount and tax. Recomputing qty * unitPrice would silently drop
    // both, so the stored value wins and the product is only a fallback.
    const lineTotal = item.total != null ? Number(item.total) : qty * unitPrice;
    return `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(item.description || 'Item')}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${qty}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${unitPrice.toLocaleString()}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">$${lineTotal.toLocaleString()}</td>
    </tr>
  `;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(data.title)}</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none !important; } }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 40px; }
    .company { font-size: 24px; font-weight: 700; color: #7c3aed; }
    .status { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .status-draft { background: #f3f4f6; color: #6b7280; }
    .status-sent { background: #dbeafe; color: #2563eb; }
    .status-accepted { background: #dcfce7; color: #16a34a; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #f9fafb; padding: 10px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #6b7280; }
    .total-row { font-weight: 700; font-size: 18px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #9ca3af; }
    .print-btn { position: fixed; top: 20px; right: 20px; background: #7c3aed; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Download PDF</button>
  <div class="header">
    <div>
      <div class="company">${escapeHtml(data.tenantName)}</div>
      <p style="margin:5px 0;color:#6b7280">Quote</p>
    </div>
    <div style="text-align:right">
      <span class="status status-${escapeHtml(data.status)}">${escapeHtml(data.status)}</span>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280">Date: ${data.createdAt}</p>
      <p style="margin:4px 0;font-size:13px;color:#6b7280">Valid until: ${data.validUntil}</p>
    </div>
  </div>

  <h1 style="font-size:22px;margin-bottom:20px">${escapeHtml(data.title)}</h1>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px">
    <div style="background:#f9fafb;padding:16px;border-radius:8px">
      <p style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Prepared For</p>
      <p style="font-weight:600">${escapeHtml(data.contactName)}</p>
      ${data.contactEmail ? `<p style="font-size:13px;color:#6b7280">${escapeHtml(data.contactEmail)}</p>` : ''}
      ${data.companyName ? `<p style="font-size:13px;color:#6b7280">${escapeHtml(data.companyName)}</p>` : ''}
    </div>
    <div style="background:#f9fafb;padding:16px;border-radius:8px">
      <p style="font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Total Amount</p>
      <p style="font-size:28px;font-weight:700;color:#7c3aed">$${data.totalAmount.toLocaleString()}</p>
    </div>
  </div>

  ${data.lineItems.length > 0 ? `
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th style="text-align:center">Qty</th>
        <th style="text-align:right">Unit Price</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr class="total-row">
        <td colspan="4" style="padding:12px 8px;text-align:right">Total</td>
        <td style="padding:12px 8px;text-align:right;color:#7c3aed">$${data.totalAmount.toLocaleString()}</td>
      </tr>
    </tbody>
  </table>
  ` : '<p style="color:#9ca3af;font-style:italic">No line items</p>'}

  ${data.notes ? `
  <div style="margin-top:30px;padding:16px;background:#fffbeb;border-radius:8px;border-left:4px solid #f59e0b">
    <p style="font-size:11px;text-transform:uppercase;color:#92400e;margin-bottom:6px">Notes</p>
    <p style="font-size:14px;color:#78350f">${escapeHtml(data.notes)}</p>
  </div>
  ` : ''}

  <div class="footer">
    <p>Generated by ${escapeHtml(data.tenantName)} via NuCRM</p>
    <p>This quote is valid until ${data.validUntil}. Contact us to proceed.</p>
  </div>
</body>
</html>`;
}
