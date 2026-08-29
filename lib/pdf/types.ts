/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Shared input types for the server-side PDF module (lib/pdf/render.ts).
 *
 * Money fields are typed `number | string | null` on purpose: Postgres decimal
 * columns come back from pg/Drizzle as strings, callers sometimes pre-coerce to
 * numbers, and optional amounts can be null/absent. The renderers normalise
 * these through a single formatter so every document is consistent.
 *
 * Branding: the schema has NO logoUrl / brand-color columns today. The only
 * branding source available is the tenant name, so `brandName` is the sole
 * branding input and the renderers fall back to a default accent color. If
 * branding columns are added later, extend `PdfBranding` here.
 */

/** A money amount as it may arrive from the DB layer or a caller. */
export type Money = number | string | null;

/** Branding inputs. Tenant name is the only branding source in the schema. */
export interface PdfBranding {
  /** Tenant/company display name shown in the header and footer. */
  brandName?: string;
}

/** A single row in a document's line-items table. */
export interface PdfLineItem {
  description: string | null;
  quantity: Money;
  unitPrice: Money;
  /**
   * Authoritative line total. For quotes/invoices this already includes any
   * per-line discount/tax, so it must NOT be recomputed as qty * unitPrice.
   */
  total: Money;
}

/** A contact/company the document is addressed to. */
export interface PdfParty {
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/** Totals block. Zero/absent rows are omitted at render time. */
export interface PdfTotals {
  subtotal?: Money;
  discount?: Money;
  tax?: Money;
  total?: Money;
  amountPaid?: Money;
  balanceDue?: Money;
}

/** Input for {@link renderInvoicePdf}. */
export interface InvoicePdfData extends PdfBranding {
  invoiceNumber?: string | null;
  title?: string | null;
  status?: string | null;
  issueDate?: string | Date | null;
  dueDate?: string | Date | null;
  billTo?: PdfParty;
  lineItems: PdfLineItem[];
  totals?: PdfTotals;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
}

/** Input for {@link renderQuotePdf}. */
export interface QuotePdfData extends PdfBranding {
  quoteNumber?: string | null;
  title?: string | null;
  status?: string | null;
  createdAt?: string | Date | null;
  /** quotes uses expiresAt; there is no validUntil column in the schema. */
  validUntil?: string | Date | null;
  preparedFor?: PdfParty;
  lineItems: PdfLineItem[];
  totals?: PdfTotals;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
}

/** Input for {@link renderContractPdf}. Summary-level: no line-items table exists. */
export interface ContractPdfData extends PdfBranding {
  contractNumber?: string | null;
  title?: string | null;
  status?: string | null;
  contractType?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  totalValue?: Money;
  billingFrequency?: string | null;
  preparedFor?: PdfParty;
  terms?: string | null;
  notes?: string | null;
  footer?: string | null;
}

/** Input for {@link renderReportPdf} — CSV-equivalent tabular data. */
export interface ReportPdfData extends PdfBranding {
  title: string;
  subtitle?: string | null;
  /** Column header labels, left-to-right. */
  columns: string[];
  /** Row values as strings; index-aligned with `columns`. */
  rows: string[][];
  generatedAt?: string | Date | null;
  footer?: string | null;
}
