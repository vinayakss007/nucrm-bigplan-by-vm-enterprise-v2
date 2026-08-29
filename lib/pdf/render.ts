/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Server-side PDF module (foundation for #1630 / #1614).
 *
 * Pure-JS document generation via pdfkit — no headless Chromium, puppeteer, or
 * native binaries — so it runs in the plain Node server runtime the app is
 * deployed under (pm2 `next start`). Each renderer builds a PDFDocument, collects
 * its stream chunks, and resolves a Buffer on the document 'end' event.
 *
 * Branding: the schema has NO logoUrl / brand-color columns today, so the only
 * branding source is the tenant name (`brandName`). A default accent color is
 * used for headings; extend PdfBranding + this module if branding columns land.
 *
 * Privacy: these renderers never log document contents or PII.
 */
import PDFDocument from 'pdfkit';
import type {
  ContractPdfData,
  InvoicePdfData,
  Money,
  PdfLineItem,
  PdfParty,
  PdfTotals,
  QuotePdfData,
  ReportPdfData,
} from '@/lib/pdf/types';

/** Default accent color used for headings (no brand-color column exists yet). */
const ACCENT = '#7c3aed';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const PAGE_MARGIN = 50;

/**
 * Currency formatter mirroring the existing routes' Intl.NumberFormat 'en-US'
 * USD formatting. Null/undefined/unparseable amounts render as $0.00.
 */
function formatCurrency(amount: Money | undefined): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount ?? 0;
  const safe = Number.isFinite(num as number) ? (num as number) : 0;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(safe);
}

/** Coerce a Money value to a finite number (0 fallback). */
function toNumber(amount: Money | undefined): number {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount ?? 0;
  return Number.isFinite(num as number) ? (num as number) : 0;
}

/** Format a quantity for display without forcing decimals. */
function formatQuantity(qty: Money | undefined): string {
  return String(toNumber(qty));
}

/** Format a date-like value; returns null when absent/invalid. */
function formatDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US');
}

/**
 * Collect a PDFDocument's stream chunks into a single Buffer, resolving on 'end'
 * and rejecting on 'error'. Calls doc.end() to flush the document.
 */
function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function newDocument(): PDFKit.PDFDocument {
  return new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
}

/** Branded header: brand name (accent) on the left, document title/number right. */
function drawHeader(
  doc: PDFKit.PDFDocument,
  opts: { brandName?: string; docLabel: string; docNumber?: string | null; status?: string | null },
): void {
  const top = doc.y;
  doc
    .fillColor(ACCENT)
    .fontSize(20)
    .font('Helvetica-Bold')
    .text(opts.brandName?.trim() || 'NuCRM', PAGE_MARGIN, top, { continued: false });

  const rightWidth = 220;
  const rightX = doc.page.width - PAGE_MARGIN - rightWidth;
  doc.fontSize(16).fillColor('#111827').text(opts.docLabel, rightX, top, { width: rightWidth, align: 'right' });
  if (opts.docNumber) {
    doc.fontSize(11).fillColor(MUTED).text(String(opts.docNumber), rightX, doc.y, { width: rightWidth, align: 'right' });
  }
  if (opts.status) {
    doc
      .fontSize(10)
      .fillColor(ACCENT)
      .text(String(opts.status).toUpperCase(), rightX, doc.y + 2, { width: rightWidth, align: 'right' });
  }

  const lineY = Math.max(doc.y, top + 40) + 8;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(doc.page.width - PAGE_MARGIN, lineY)
    .strokeColor(BORDER)
    .lineWidth(1)
    .stroke();
  doc.fillColor('#1a1a1a').font('Helvetica').fontSize(11);
  doc.x = PAGE_MARGIN;
  doc.y = lineY + 16;
}

/** A labelled key/value meta line. */
function drawMetaLine(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc
    .fontSize(10)
    .fillColor(MUTED)
    .text(`${label}: `, { continued: true })
    .fillColor('#111827')
    .text(value);
}

/** Party block ("Bill To" / "Prepared For"). */
function drawParty(doc: PDFKit.PDFDocument, heading: string, party: PdfParty | undefined): void {
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor(MUTED).text(heading.toUpperCase());
  doc.fontSize(11).fillColor('#111827').text(party?.name?.trim() || 'N/A');
  if (party?.company?.trim()) doc.fontSize(10).fillColor(MUTED).text(party.company);
  if (party?.email?.trim()) doc.fontSize(10).fillColor(MUTED).text(party.email);
  doc.fillColor('#1a1a1a').fontSize(11);
}

/**
 * Draw a generic paginated table. `columns` gives header labels + relative
 * widths; `rows` gives per-cell strings. Flows across pages when it runs out of
 * vertical space so large reports never crash.
 */
function drawTable(
  doc: PDFKit.PDFDocument,
  columns: Array<{ label: string; width: number; align?: 'left' | 'right' | 'center' }>,
  rows: string[][],
): void {
  const startX = PAGE_MARGIN;
  const totalWidth = doc.page.width - PAGE_MARGIN * 2;
  const widthSum = columns.reduce((s, c) => s + c.width, 0) || 1;
  const colWidths = columns.map((c) => (c.width / widthSum) * totalWidth);
  const rowPadding = 6;

  const colWidthAt = (i: number): number => colWidths[i] ?? 0;

  const drawRow = (cells: string[], isHeader: boolean): void => {
    const cellHeights = cells.map((cell, i) =>
      doc.heightOfString(cell || '', { width: colWidthAt(i) - 8 }),
    );
    const rowHeight = Math.max(14, ...cellHeights) + rowPadding * 2;

    // Flow onto a new page if this row would overrun the bottom margin.
    if (doc.y + rowHeight > doc.page.height - PAGE_MARGIN) {
      doc.addPage();
    }

    const y = doc.y;
    if (isHeader) {
      doc.rect(startX, y, totalWidth, rowHeight).fill('#f9fafb');
    }

    let x = startX;
    doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHeader ? 9 : 10);
    columns.forEach((col, i) => {
      const w = colWidthAt(i);
      doc
        .fillColor(isHeader ? MUTED : '#111827')
        .text(cells[i] ?? '', x + 4, y + rowPadding, {
          width: w - 8,
          align: col.align ?? 'left',
        });
      x += w;
    });

    const bottom = y + rowHeight;
    doc
      .moveTo(startX, bottom)
      .lineTo(startX + totalWidth, bottom)
      .strokeColor(BORDER)
      .lineWidth(0.5)
      .stroke();
    doc.x = startX;
    doc.y = bottom;
  };

  drawRow(columns.map((c) => c.label), true);
  for (const row of rows) {
    drawRow(row, false);
  }
  doc.font('Helvetica').fillColor('#1a1a1a').fontSize(11);
}

/** Line-items table shared by invoice/quote. */
function drawLineItems(doc: PDFKit.PDFDocument, items: PdfLineItem[]): void {
  doc.moveDown(1);
  if (!items || items.length === 0) {
    doc.fontSize(10).fillColor(MUTED).font('Helvetica-Oblique').text('No line items.');
    doc.font('Helvetica').fillColor('#1a1a1a').fontSize(11);
    return;
  }
  const rows = items.map((item) => [
    item.description?.trim() || 'Item',
    formatQuantity(item.quantity),
    formatCurrency(item.unitPrice),
    // total is authoritative (already includes per-line discount/tax); do not recompute.
    formatCurrency(item.total),
  ]);
  drawTable(
    doc,
    [
      { label: 'Description', width: 5, align: 'left' },
      { label: 'Qty', width: 1, align: 'center' },
      { label: 'Unit Price', width: 2, align: 'right' },
      { label: 'Total', width: 2, align: 'right' },
    ],
    rows,
  );
}

/** Totals block. Zero/absent rows are omitted, matching current HTML behavior. */
function drawTotals(doc: PDFKit.PDFDocument, totals: PdfTotals | undefined): void {
  if (!totals) return;
  const rows: Array<{ label: string; value: string; emphasize?: boolean; danger?: boolean }> = [];
  const push = (label: string, amount: Money | undefined, opts?: { always?: boolean; sign?: string; emphasize?: boolean; danger?: boolean }): void => {
    const n = toNumber(amount);
    if (!opts?.always && n === 0) return;
    rows.push({
      label,
      value: `${opts?.sign ?? ''}${formatCurrency(amount)}`,
      emphasize: opts?.emphasize,
      danger: opts?.danger,
    });
  };

  push('Subtotal', totals.subtotal, { always: totals.subtotal != null });
  push('Discount', totals.discount, { sign: '-' });
  push('Tax', totals.tax);
  push('Total', totals.total, { always: totals.total != null, emphasize: true });
  push('Amount Paid', totals.amountPaid, { sign: '-' });
  push('Balance Due', totals.balanceDue, { danger: true });

  if (rows.length === 0) return;

  doc.moveDown(1);
  const boxWidth = 240;
  const boxX = doc.page.width - PAGE_MARGIN - boxWidth;
  for (const row of rows) {
    const y = doc.y;
    doc
      .font(row.emphasize ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(row.emphasize ? 13 : 10)
      .fillColor(row.danger ? '#dc2626' : '#111827')
      .text(row.label, boxX, y, { width: boxWidth / 2 })
      .text(row.value, boxX + boxWidth / 2, y, { width: boxWidth / 2, align: 'right' });
    doc.y = y + (row.emphasize ? 20 : 16);
  }
  doc.x = PAGE_MARGIN;
  doc.font('Helvetica').fillColor('#1a1a1a').fontSize(11);
}

/** Render an optional titled prose section (notes/terms). */
function drawTextSection(doc: PDFKit.PDFDocument, heading: string, body: string | null | undefined): void {
  if (!body || !body.trim()) return;
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(heading);
  doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(body.trim());
  doc.fillColor('#1a1a1a').fontSize(11);
}

/** Footer line (custom text or a generated-on stamp). */
function drawFooter(doc: PDFKit.PDFDocument, brandName?: string, custom?: string | null): void {
  doc.moveDown(2);
  const y = doc.y;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .strokeColor(BORDER)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.5);
  const text = custom?.trim() || `Generated by ${brandName?.trim() || 'NuCRM'} on ${new Date().toLocaleDateString('en-US')}`;
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text(text, { align: 'center' });
}

/** Render an invoice to a PDF Buffer. */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = newDocument();
  drawHeader(doc, { brandName: data.brandName, docLabel: 'Invoice', docNumber: data.invoiceNumber, status: data.status });

  if (data.title?.trim()) drawMetaLine(doc, 'Title', data.title.trim());
  const issued = formatDate(data.issueDate);
  if (issued) drawMetaLine(doc, 'Issued', issued);
  const due = formatDate(data.dueDate);
  if (due) drawMetaLine(doc, 'Due', due);

  drawParty(doc, 'Bill To', data.billTo);
  drawLineItems(doc, data.lineItems ?? []);
  drawTotals(doc, data.totals);
  drawTextSection(doc, 'Notes', data.notes);
  drawTextSection(doc, 'Terms & Conditions', data.terms);
  drawFooter(doc, data.brandName, data.footer);

  return streamToBuffer(doc);
}

/** Render a quote to a PDF Buffer. */
export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  const doc = newDocument();
  drawHeader(doc, { brandName: data.brandName, docLabel: 'Quote', docNumber: data.quoteNumber, status: data.status });

  if (data.title?.trim()) drawMetaLine(doc, 'Title', data.title.trim());
  const created = formatDate(data.createdAt);
  if (created) drawMetaLine(doc, 'Date', created);
  // quotes uses expiresAt; there is no validUntil column in the schema.
  const validUntil = formatDate(data.validUntil);
  if (validUntil) drawMetaLine(doc, 'Valid Until', validUntil);

  drawParty(doc, 'Prepared For', data.preparedFor);
  drawLineItems(doc, data.lineItems ?? []);
  drawTotals(doc, data.totals);
  drawTextSection(doc, 'Notes', data.notes);
  drawTextSection(doc, 'Terms & Conditions', data.terms);
  drawFooter(doc, data.brandName, data.footer);

  return streamToBuffer(doc);
}

/** Render a contract summary to a PDF Buffer (no line-items table exists). */
export async function renderContractPdf(data: ContractPdfData): Promise<Buffer> {
  const doc = newDocument();
  drawHeader(doc, { brandName: data.brandName, docLabel: 'Contract', docNumber: data.contractNumber, status: data.status });

  if (data.title?.trim()) drawMetaLine(doc, 'Title', data.title.trim());
  if (data.contractType?.trim()) drawMetaLine(doc, 'Type', data.contractType.trim());
  const start = formatDate(data.startDate);
  if (start) drawMetaLine(doc, 'Start', start);
  const end = formatDate(data.endDate);
  if (end) drawMetaLine(doc, 'End', end);
  if (data.billingFrequency?.trim()) drawMetaLine(doc, 'Billing', data.billingFrequency.trim());

  drawParty(doc, 'Prepared For', data.preparedFor);

  if (toNumber(data.totalValue) !== 0 || data.totalValue != null) {
    doc.moveDown(1);
    drawTotals(doc, { total: data.totalValue });
  }

  drawTextSection(doc, 'Terms & Conditions', data.terms);
  drawTextSection(doc, 'Notes', data.notes);
  drawFooter(doc, data.brandName, data.footer);

  return streamToBuffer(doc);
}

/** Render a tabular report (CSV-equivalent) to a PDF Buffer; paginates rows. */
export async function renderReportPdf(data: ReportPdfData): Promise<Buffer> {
  const doc = newDocument();
  drawHeader(doc, { brandName: data.brandName, docLabel: data.title || 'Report' });

  if (data.subtitle?.trim()) {
    doc.fontSize(11).fillColor(MUTED).text(data.subtitle.trim());
  }
  const generated = formatDate(data.generatedAt) ?? new Date().toLocaleDateString('en-US');
  drawMetaLine(doc, 'Generated', generated);

  const columns = (data.columns ?? []).map((label) => ({ label, width: 1, align: 'left' as const }));
  if (columns.length === 0) {
    doc.moveDown(1).fontSize(10).fillColor(MUTED).font('Helvetica-Oblique').text('No data.');
    doc.font('Helvetica').fillColor('#1a1a1a').fontSize(11);
  } else {
    doc.moveDown(1);
    drawTable(doc, columns, data.rows ?? []);
  }

  drawFooter(doc, data.brandName, data.footer);
  return streamToBuffer(doc);
}
