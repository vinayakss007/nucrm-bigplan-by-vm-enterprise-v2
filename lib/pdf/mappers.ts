/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Pure row -> PdfData mappers for the tenant PDF routes (#1630).
 *
 * These helpers translate the exact Drizzle query shapes used by the
 * invoice/quote/contract /pdf routes into the {@link InvoicePdfData} /
 * {@link QuotePdfData} / {@link ContractPdfData} inputs consumed by the
 * renderers in lib/pdf/render.ts. Keeping the mapping here (rather than inline
 * in the route handlers) means it can be unit-tested without a database or
 * faked auth — the route handlers just fetch rows and pass them through.
 *
 * Conventions preserved from the existing routes:
 *  - Money columns arrive from pg/Drizzle as strings; the renderers normalise
 *    them, so we pass them through as-is (Money = number | string | null).
 *  - Quote line-item `.total` is authoritative (already includes per-line
 *    discount/tax); qty * unitPrice is only a fallback when total is absent.
 *  - Quotes use the `expiresAt` column mapped onto QuotePdfData.validUntil.
 */
import type {
  ContractPdfData,
  InvoicePdfData,
  Money,
  PdfLineItem,
  QuotePdfData,
} from '@/lib/pdf/types';

/** A line-item row as returned by the invoice/quote queries. */
export interface LineItemRow {
  description: string | null;
  quantity: Money;
  unitPrice: Money;
  total: Money;
}

/** The invoice row shape (full-row `select()` from the invoices table). */
export interface InvoiceRow {
  invoiceNumber?: string | null;
  title?: string | null;
  status?: string | null;
  issueDate?: string | Date | null;
  dueDate?: string | Date | null;
  subtotal?: Money;
  discountAmount?: Money;
  taxAmount?: Money;
  totalAmount?: Money;
  amountPaid?: Money;
  balanceDue?: Money;
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
}

/** The quote row shape (projected select from the quotes route). */
export interface QuoteRow {
  id: string;
  title?: string | null;
  status?: string | null;
  totalAmount?: Money;
  /** quotes uses expiresAt; there is no validUntil column. */
  validUntil?: string | Date | null;
  notes?: string | null;
  createdAt?: string | Date | null;
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactEmail?: string | null;
  companyName?: string | null;
}

/** The contract row shape (full-row select from the contracts table). */
export interface ContractRow {
  id: string;
  title?: string | null;
  contractNumber?: string | null;
  contractType?: string | null;
  status?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  totalValue?: Money;
  billingFrequency?: string | null;
  terms?: string | null;
  notes?: string | null;
}

/** A contact/company row joined onto a contract. */
export interface ContractPartyRow {
  contactFirstName?: string | null;
  contactLastName?: string | null;
  contactEmail?: string | null;
  companyName?: string | null;
}

/** Map raw line-item rows to renderer line items (passing Money through as-is). */
function mapLineItems(rows: LineItemRow[]): PdfLineItem[] {
  return (rows ?? []).map((row) => ({
    description: row.description ?? null,
    quantity: row.quantity ?? null,
    unitPrice: row.unitPrice ?? null,
    // total is authoritative; the renderer displays it verbatim.
    total: row.total ?? null,
  }));
}

/** Join a first/last name into a display name, or null when both absent. */
function joinName(first?: string | null, last?: string | null): string | null {
  const name = [first, last].filter((p) => p && p.trim()).join(' ').trim();
  return name || null;
}

/** Map an invoice row + line items + contact name to {@link InvoicePdfData}. */
export function mapInvoiceToPdfData(
  invoice: InvoiceRow,
  lineItems: LineItemRow[],
  contactName: string,
  brandName?: string,
): InvoicePdfData {
  return {
    brandName,
    invoiceNumber: invoice.invoiceNumber ?? null,
    title: invoice.title ?? null,
    status: invoice.status ?? null,
    issueDate: invoice.issueDate ?? null,
    dueDate: invoice.dueDate ?? null,
    billTo: { name: contactName || null },
    lineItems: mapLineItems(lineItems),
    totals: {
      subtotal: invoice.subtotal ?? null,
      discount: invoice.discountAmount ?? null,
      tax: invoice.taxAmount ?? null,
      total: invoice.totalAmount ?? null,
      amountPaid: invoice.amountPaid ?? null,
      balanceDue: invoice.balanceDue ?? null,
    },
    notes: invoice.notes ?? null,
    terms: invoice.terms ?? null,
    footer: invoice.footer ?? null,
  };
}

/** Map a quote row + line items + tenant name to {@link QuotePdfData}. */
export function mapQuoteToPdfData(
  quote: QuoteRow,
  lineItems: LineItemRow[],
  brandName?: string,
): QuotePdfData {
  return {
    brandName,
    quoteNumber: quote.title || `Quote #${quote.id.slice(0, 8)}`,
    title: quote.title ?? null,
    status: quote.status ?? null,
    createdAt: quote.createdAt ?? null,
    // quotes uses expiresAt; mapped here onto validUntil.
    validUntil: quote.validUntil ?? null,
    preparedFor: {
      name: joinName(quote.contactFirstName, quote.contactLastName),
      email: quote.contactEmail ?? null,
      company: quote.companyName ?? null,
    },
    lineItems: mapLineItems(lineItems),
    totals: { total: quote.totalAmount ?? null },
    notes: quote.notes ?? null,
  };
}

/**
 * Map a contract row (+ optional joined party) to {@link ContractPdfData}.
 * Contracts have NO line-items table, so this produces a summary document only.
 */
export function mapContractToPdfData(
  contract: ContractRow,
  party?: ContractPartyRow,
  brandName?: string,
): ContractPdfData {
  return {
    brandName,
    contractNumber: contract.contractNumber ?? null,
    title: contract.title ?? null,
    status: contract.status ?? null,
    contractType: contract.contractType ?? null,
    startDate: contract.startDate ?? null,
    endDate: contract.endDate ?? null,
    totalValue: contract.totalValue ?? null,
    billingFrequency: contract.billingFrequency ?? null,
    preparedFor: party
      ? {
          name: joinName(party.contactFirstName, party.contactLastName),
          email: party.contactEmail ?? null,
          company: party.companyName ?? null,
        }
      : undefined,
    terms: contract.terms ?? null,
    notes: contract.notes ?? null,
  };
}
