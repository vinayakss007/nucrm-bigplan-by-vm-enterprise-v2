import { describe, it, expect } from 'vitest';
import type {
  ContractRow,
  ContractPartyRow,
  InvoiceRow,
  LineItemRow,
  QuoteRow,
} from '@/lib/pdf/mappers';

/**
 * Unit tests for the row -> PdfData mappers that back the tenant PDF routes
 * (#1630). These exercise the pure mapping layer + renderers WITHOUT a database
 * or faked auth: the route handlers only add requireAuth/tenant-scoping/queries,
 * which are left to integration testing.
 */

/** Assert a value is a non-empty Buffer whose first bytes are the '%PDF-' magic. */
function expectPdfBuffer(buf: unknown): void {
  expect(Buffer.isBuffer(buf)).toBe(true);
  const b = buf as Buffer;
  expect(b.length).toBeGreaterThan(0);
  expect(b.subarray(0, 5).toString('latin1')).toBe('%PDF-');
}

// Money columns arrive from pg as strings — mirror that in the fixtures.
const INVOICE_ROW: InvoiceRow = {
  invoiceNumber: 'INV-1001',
  title: 'Consulting services',
  status: 'sent',
  issueDate: '2026-01-05T00:00:00.000Z',
  dueDate: '2026-02-05T00:00:00.000Z',
  subtotal: '1000.00',
  discountAmount: '100.00',
  taxAmount: '90.00',
  totalAmount: '990.00',
  amountPaid: '0.00',
  balanceDue: '990.00',
  notes: 'Thank you for your business.',
  terms: 'Net 30.',
  footer: null,
};

const INVOICE_ITEMS: LineItemRow[] = [
  { description: 'Discovery workshop', quantity: '2', unitPrice: '250.00', total: '450.00' },
  { description: 'Implementation', quantity: '1', unitPrice: '550.00', total: '540.00' },
];

const QUOTE_ROW: QuoteRow = {
  id: '11111111-2222-3333-4444-555555555555',
  title: 'Website revamp',
  status: 'draft',
  totalAmount: '4200.00',
  validUntil: '2026-03-01T00:00:00.000Z',
  notes: 'Valid for 30 days.',
  createdAt: '2026-01-30T00:00:00.000Z',
  contactFirstName: 'Ada',
  contactLastName: 'Lovelace',
  contactEmail: 'ada@example.com',
  companyName: 'Analytical Engines Ltd',
};

const QUOTE_ITEMS: LineItemRow[] = [
  { description: 'Design', quantity: '1', unitPrice: '2000.00', total: '2000.00' },
  // total is authoritative (includes per-line discount/tax): 2200, NOT 3 * 800.
  { description: 'Build', quantity: '3', unitPrice: '800.00', total: '2200.00' },
];

const CONTRACT_ROW: ContractRow = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  title: 'Master Services Agreement',
  contractNumber: 'CON-2026-007',
  contractType: 'service',
  status: 'active',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  totalValue: '120000.00',
  billingFrequency: 'monthly',
  terms: 'Auto-renews annually unless cancelled.',
  notes: 'Priority support included.',
};

const CONTRACT_PARTY: ContractPartyRow = {
  contactFirstName: 'Grace',
  contactLastName: 'Hopper',
  contactEmail: 'grace@example.com',
  companyName: 'Navy Systems',
};

describe('lib/pdf/mappers -> renderers', () => {
  it('exports the three mappers', async () => {
    const mod = await import('@/lib/pdf/mappers');
    expect(typeof mod.mapInvoiceToPdfData).toBe('function');
    expect(typeof mod.mapQuoteToPdfData).toBe('function');
    expect(typeof mod.mapContractToPdfData).toBe('function');
  });

  it('maps an invoice row and renders a %PDF- buffer', async () => {
    const { mapInvoiceToPdfData } = await import('@/lib/pdf/mappers');
    const { renderInvoicePdf } = await import('@/lib/pdf/render');

    const data = mapInvoiceToPdfData(INVOICE_ROW, INVOICE_ITEMS, 'Ada Lovelace', 'Acme Corp');
    expect(data.invoiceNumber).toBe('INV-1001');
    expect(data.billTo?.name).toBe('Ada Lovelace');
    expect(data.totals?.total).toBe('990.00');
    expect(data.lineItems).toHaveLength(2);
    // total passes through unchanged (authoritative, not recomputed).
    expect(data.lineItems[1].total).toBe('540.00');

    expectPdfBuffer(await renderInvoicePdf(data));
  });

  it('maps a quote row (expiresAt -> validUntil, authoritative total) and renders a %PDF- buffer', async () => {
    const { mapQuoteToPdfData } = await import('@/lib/pdf/mappers');
    const { renderQuotePdf } = await import('@/lib/pdf/render');

    const data = mapQuoteToPdfData(QUOTE_ROW, QUOTE_ITEMS, 'Acme Corp');
    expect(data.validUntil).toBe('2026-03-01T00:00:00.000Z');
    expect(data.preparedFor?.name).toBe('Ada Lovelace');
    expect(data.preparedFor?.company).toBe('Analytical Engines Ltd');
    // authoritative line total preserved, not 3 * 800.
    expect(data.lineItems[1].total).toBe('2200.00');

    expectPdfBuffer(await renderQuotePdf(data));
  });

  it('falls back to a Quote # label when the quote has no title', async () => {
    const { mapQuoteToPdfData } = await import('@/lib/pdf/mappers');
    const data = mapQuoteToPdfData({ ...QUOTE_ROW, title: null }, QUOTE_ITEMS);
    expect(data.quoteNumber).toBe('Quote #11111111');
  });

  it('maps a contract row (summary-only, no line items) and renders a %PDF- buffer', async () => {
    const { mapContractToPdfData } = await import('@/lib/pdf/mappers');
    const { renderContractPdf } = await import('@/lib/pdf/render');

    const data = mapContractToPdfData(CONTRACT_ROW, CONTRACT_PARTY, 'Acme Corp');
    expect(data.contractNumber).toBe('CON-2026-007');
    expect(data.totalValue).toBe('120000.00');
    expect(data.preparedFor?.name).toBe('Grace Hopper');
    // Contracts have no line-items entity, so ContractPdfData carries none.
    expect((data as Record<string, unknown>).lineItems).toBeUndefined();

    expectPdfBuffer(await renderContractPdf(data));
  });

  it('maps a contract with no joined party (party omitted)', async () => {
    const { mapContractToPdfData } = await import('@/lib/pdf/mappers');
    const { renderContractPdf } = await import('@/lib/pdf/render');

    const data = mapContractToPdfData(CONTRACT_ROW);
    expect(data.preparedFor).toBeUndefined();
    expectPdfBuffer(await renderContractPdf(data));
  });
});
