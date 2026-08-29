import { describe, it, expect } from 'vitest';
import type {
  ContractPdfData,
  InvoicePdfData,
  QuotePdfData,
  ReportPdfData,
} from '@/lib/pdf/types';

/** Assert a value is a non-empty Buffer whose first bytes are the '%PDF-' magic. */
function expectPdfBuffer(buf: unknown): void {
  expect(Buffer.isBuffer(buf)).toBe(true);
  const b = buf as Buffer;
  expect(b.length).toBeGreaterThan(0);
  expect(b.subarray(0, 5).toString('latin1')).toBe('%PDF-');
}

const LONG_TEXT =
  'This is a very long multi-line description that must wrap across the ' +
  'available column width without throwing. ' +
  'Repeated content follows to force wrapping. '.repeat(20);

const UNICODE = 'café — 日本語 — Ω ≈ ç √ ∫ 😀';

describe('lib/pdf/render', () => {
  it('exports all four renderers', async () => {
    const mod = await import('@/lib/pdf/render');
    expect(typeof mod.renderInvoicePdf).toBe('function');
    expect(typeof mod.renderQuotePdf).toBe('function');
    expect(typeof mod.renderContractPdf).toBe('function');
    expect(typeof mod.renderReportPdf).toBe('function');
  });

  describe('renderInvoicePdf', () => {
    it('renders a fully-populated invoice', async () => {
      const { renderInvoicePdf } = await import('@/lib/pdf/render');
      const data: InvoicePdfData = {
        brandName: 'Acme Corp',
        invoiceNumber: 'INV-1001',
        title: 'Consulting Services',
        status: 'sent',
        issueDate: '2026-01-15',
        dueDate: new Date('2026-02-15'),
        billTo: { name: 'Jane Doe', company: 'Widgets Inc', email: 'jane@example.com' },
        lineItems: [
          { description: 'Design', quantity: '2', unitPrice: '500.00', total: '1000.00' },
          { description: LONG_TEXT, quantity: 1, unitPrice: 250, total: 250 },
        ],
        totals: { subtotal: '1250.00', discount: '50.00', tax: '120.00', total: '1320.00', amountPaid: '320.00', balanceDue: '1000.00' },
        notes: 'Thank you for your business.',
        terms: 'Net 30.',
      };
      expectPdfBuffer(await renderInvoicePdf(data));
    });

    it('does not throw on empty line items and missing optional fields', async () => {
      const { renderInvoicePdf } = await import('@/lib/pdf/render');
      const data: InvoicePdfData = { lineItems: [] };
      expectPdfBuffer(await renderInvoicePdf(data));
    });

    it('handles unicode and null money fields', async () => {
      const { renderInvoicePdf } = await import('@/lib/pdf/render');
      const data: InvoicePdfData = {
        brandName: UNICODE,
        title: UNICODE,
        lineItems: [{ description: UNICODE, quantity: null, unitPrice: null, total: null }],
        totals: { subtotal: null, total: null },
      };
      expectPdfBuffer(await renderInvoicePdf(data));
    });
  });

  describe('renderQuotePdf', () => {
    it('renders a populated quote', async () => {
      const { renderQuotePdf } = await import('@/lib/pdf/render');
      const data: QuotePdfData = {
        brandName: 'Acme Corp',
        quoteNumber: 'Q-2001',
        title: 'Annual Plan',
        status: 'draft',
        createdAt: '2026-03-01',
        validUntil: '2026-04-01',
        preparedFor: { name: 'John Smith', company: 'Globex' },
        lineItems: [{ description: 'License', quantity: '10', unitPrice: '99.00', total: '990.00' }],
        totals: { subtotal: '990.00', total: '990.00' },
        notes: UNICODE,
      };
      expectPdfBuffer(await renderQuotePdf(data));
    });

    it('does not throw with empty items, long text and no optional fields', async () => {
      const { renderQuotePdf } = await import('@/lib/pdf/render');
      const data: QuotePdfData = {
        title: LONG_TEXT,
        lineItems: [],
      };
      expectPdfBuffer(await renderQuotePdf(data));
    });
  });

  describe('renderContractPdf', () => {
    it('renders a populated contract summary', async () => {
      const { renderContractPdf } = await import('@/lib/pdf/render');
      const data: ContractPdfData = {
        brandName: 'Acme Corp',
        contractNumber: 'C-3001',
        title: 'Master Services Agreement',
        status: 'active',
        contractType: 'MSA',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        totalValue: '50000.00',
        billingFrequency: 'monthly',
        preparedFor: { name: 'Contoso Ltd' },
        terms: LONG_TEXT,
        notes: UNICODE,
      };
      expectPdfBuffer(await renderContractPdf(data));
    });

    it('does not throw with only required-shape fields', async () => {
      const { renderContractPdf } = await import('@/lib/pdf/render');
      const data: ContractPdfData = {};
      expectPdfBuffer(await renderContractPdf(data));
    });
  });

  describe('renderReportPdf', () => {
    it('renders a tabular report', async () => {
      const { renderReportPdf } = await import('@/lib/pdf/render');
      const data: ReportPdfData = {
        brandName: 'Acme Corp',
        title: 'Contacts Export',
        subtitle: 'Q1 2026',
        columns: ['Name', 'Email', 'Company'],
        rows: [
          ['Jane Doe', 'jane@example.com', 'Widgets Inc'],
          [UNICODE, 'unicode@example.com', LONG_TEXT],
        ],
      };
      expectPdfBuffer(await renderReportPdf(data));
    });

    it('paginates many rows without throwing', async () => {
      const { renderReportPdf } = await import('@/lib/pdf/render');
      const rows: string[][] = Array.from({ length: 300 }, (_, i) => [
        `Row ${i}`,
        `row${i}@example.com`,
        `Company ${i}`,
      ]);
      const data: ReportPdfData = { title: 'Big Report', columns: ['Name', 'Email', 'Company'], rows };
      expectPdfBuffer(await renderReportPdf(data));
    });

    it('does not throw on empty columns and rows', async () => {
      const { renderReportPdf } = await import('@/lib/pdf/render');
      const data: ReportPdfData = { title: 'Empty', columns: [], rows: [] };
      expectPdfBuffer(await renderReportPdf(data));
    });
  });
});
