/**
 * #3142 — `recalculateInvoicePayments()` owns `invoices.paid_at` (since #2226
 * removed stamping from the PATCH route), and it stamped `new Date()` whenever
 * the balance was closed. It never READ the existing stamp, so any recalc while
 * the invoice sat paid moved the settlement date to now:
 *
 *   - editing a line item on a paid invoice (`app/api/tenant/invoices/[id]/route.ts:246`),
 *   - a PayU webhook replay (`app/api/webhooks/payu/route.ts:191,226` — twice per event),
 *   - an unrelated payment edit elsewhere in the same ledger,
 *
 * each re-dated a customer's paid invoice, arbitrarily many times, and that date
 * is what /api/public/invoices serves and what aging/dunning analytics bucket on.
 *
 * The property: the stamp marks the unpaid→paid TRANSITION. Staying paid must
 * preserve it; reopening the balance must still clear it (that half was already
 * correct, and is pinned so the fix does not "preserve" a stale date into a
 * partially-paid invoice).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@/drizzle/schema', () => ({
  invoices: {
    id: 'invoices.id',
    tenantId: 'invoices.tenant_id',
    status: 'invoices.status',
    totalAmount: 'invoices.total_amount',
    amountPaid: 'invoices.amount_paid',
    balanceDue: 'invoices.balance_due',
    paidAt: 'invoices.paid_at',
    deletedAt: 'invoices.deleted_at',
    updatedAt: 'invoices.updated_at',
  },
  invoicePayments: {
    id: 'invoice_payments.id',
    tenantId: 'invoice_payments.tenant_id',
    invoiceId: 'invoice_payments.invoice_id',
    amount: 'invoice_payments.amount',
    deletedAt: 'invoice_payments.deleted_at',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...p: unknown[]) => ({ and: p })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: Array.from(strings).join('?'),
      values,
    }),
    { raw: (s: string) => ({ raw: s }) },
  ),
}));

import { recalculateInvoicePayments } from '@/lib/billing/payments';

const TENANT = 'tenant-1';
const INVOICE = 'inv-1';
/** Settled long ago — the date the customer was told about. */
const SETTLED = new Date('2026-04-11T09:30:00.000Z');

type FakeTx = ReturnType<typeof makeTx>;

/**
 * Mirrors the real drizzle chain the function walks — `.select().from().where()`
 * resolved directly for the ledger sum and `.limit(1)` for the invoice row, then one
 * `.update().set().where()` write whose patch is captured for assertion.
 */
function makeTx(rows: { invoice: Record<string, unknown>; ledgerSum: string }) {
  const selects: unknown[][] = [
    [rows.invoice],
    [{ total: rows.ledgerSum }],
  ];
  const next = (): Promise<unknown[]> => Promise.resolve(selects.shift() ?? []);

  const patches: Record<string, unknown>[] = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => next();
  chain.then = (ok?: (v: unknown) => unknown, err?: (reason: unknown) => unknown) => next().then(ok, err);
  chain.update = () => ({
    set: (values: Record<string, unknown>) => {
      patches.push(values);
      return { where: () => Promise.resolve({ rowCount: 1 }) };
    },
  });

  return { tx: chain as unknown as FakeTx, patches };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recalculateInvoicePayments keeps a settlement date it did not change (#3142)', () => {
  it('leaves paid_at alone when a paid invoice is recalculated while still fully paid', async () => {
    const { tx, patches } = makeTx({
      invoice: { totalAmount: '100.00', status: 'paid', paidAt: SETTLED },
      ledgerSum: '100.00',
    });
    const totals = await recalculateInvoicePayments(tx, INVOICE, TENANT);

    // A webhook replay or an unrelated ledger edit re-runs this on an invoice that
    // has been paid since April. The written date must still be April.
    expect(patches[0]?.paidAt).toBe(SETTLED);
    expect(totals.paidAt).toBe(SETTLED);
    expect(totals.status).toBe('paid');
  });

  it('stamps now on the unpaid -> paid transition', async () => {
    const { tx, patches } = makeTx({
      invoice: { totalAmount: '100.00', status: 'partially_paid', paidAt: null },
      ledgerSum: '100.00',
    });
    const before = Date.now();
    const totals = await recalculateInvoicePayments(tx, INVOICE, TENANT);

    expect(patches[0]?.paidAt).toBeInstanceOf(Date);
    expect(Number(patches[0]?.paidAt)).toBeGreaterThanOrEqual(before);
    expect(totals.status).toBe('paid');
  });

  it('clears paid_at when a refund reopens the balance, even though the row was paid', async () => {
    const { tx, patches } = makeTx({
      invoice: { totalAmount: '100.00', status: 'paid', paidAt: SETTLED },
      ledgerSum: '40.00',
    });
    const totals = await recalculateInvoicePayments(tx, INVOICE, TENANT);

    expect(patches[0]?.paidAt).toBeNull();
    expect(totals.paidAt).toBeNull();
    expect(totals.status).toBe('partially_paid');
  });

  it('stamps a paid row that carries no stamp yet, so the column cannot stay empty on a settled invoice', async () => {
    // Legacy rows predating #2226 can sit `paid` with paid_at NULL. The transition
    // has been observed but never recorded; "now" is the honest answer, and it is
    // what the base did for every row — this case keeps that behaviour where it is
    // actually correct.
    const { tx, patches } = makeTx({
      invoice: { totalAmount: '100.00', status: 'paid', paidAt: null },
      ledgerSum: '100.00',
    });
    const totals = await recalculateInvoicePayments(tx, INVOICE, TENANT);

    expect(patches[0]?.paidAt).toBeInstanceOf(Date);
    expect(totals.paidAt).toBeInstanceOf(Date);
  });

  it('does not touch paid_at on an invoice that never reached paid', async () => {
    const { tx, patches } = makeTx({
      invoice: { totalAmount: '100.00', status: 'sent', paidAt: null },
      ledgerSum: '30.00',
    });
    await recalculateInvoicePayments(tx, INVOICE, TENANT);
    expect(patches[0]?.paidAt).toBeNull();
  });
});
