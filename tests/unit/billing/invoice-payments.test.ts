/**
 * Tests for lib/billing/payments.ts — the invoice payment ledger.
 *
 * `invoice_payments` existed with no writer anywhere, while `amount_paid` and
 * `balance_due` were hand-editable on the invoice PATCH. The property these
 * tests exist to protect is that the summary is DERIVED from the ledger and
 * cannot disagree with it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
  /** Queue of results for successive select() chains, in call order. */
  const selects: unknown[][] = [];
  const next = (): unknown[] => (selects.length ? (selects.shift() as unknown[]) : []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => Promise.resolve(next()));
  chain.limit = vi.fn(() => Promise.resolve(next()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (ok: any, err: any) => Promise.resolve(next()).then(ok, err);

  const updateSet = vi.fn();
  const insertReturning = vi.fn();

  chain.update = vi.fn(() => ({
    set: (values: unknown) => {
      updateSet(values);
      return { where: vi.fn(() => Promise.resolve({ rowCount: 1 })) };
    },
  }));
  chain.insert = vi.fn(() => ({
    values: (values: unknown) => {
      insertReturning.mock.calls.push([values]);
      return { returning: () => Promise.resolve([{ id: 'pay-new', ...(values as object) }]) };
    },
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.transaction = vi.fn(async (cb: any) => cb(chain));

  return { db: chain, selects, updateSet, insertReturning };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
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
    paymentDate: 'invoice_payments.payment_date',
    deletedAt: 'invoice_payments.deleted_at',
    updatedAt: 'invoice_payments.updated_at',
    deletedBy: 'invoice_payments.deleted_by',
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
    { raw: (s: string) => ({ raw: s }) }
  ),
}));

import {
  recordInvoicePayment,
  voidInvoicePayment,
  PaymentError,
} from '@/lib/billing/payments';

const TENANT = 'tenant-1';
const USER = 'user-1';
const INVOICE = 'inv-1';

/** Most recent object passed to update().set(). */
function lastUpdate(): Record<string, unknown> {
  const calls = m.updateSet.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

function queue(...results: unknown[][]): void {
  m.selects.push(...results);
}

/** invoice lookup, then existing-sum lookup, then recalc's invoice + sum. */
function queueRecordPayment(opts: {
  total: string;
  alreadyPaid: string;
  status?: string;
  sumAfter: string;
}) {
  queue(
    [{ id: INVOICE, status: opts.status ?? 'sent', totalAmount: opts.total }], // guard lookup
    [{ total: opts.alreadyPaid }], // overpayment check
    [{ totalAmount: opts.total, status: opts.status ?? 'sent' }], // recalc invoice
    [{ total: opts.sumAfter }], // recalc ledger sum
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.selects.length = 0;
});

describe('recordInvoicePayment', () => {
  it('derives amount_paid and balance_due from the ledger sum, not the request', async () => {
    // The request says 40, but the ledger sums to 100 — the summary must follow
    // the ledger.
    queueRecordPayment({ total: '250.00', alreadyPaid: '60.00', sumAfter: '100.00' });

    const { totals } = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 40, paymentDate: '2026-07-27',
    });

    expect(totals.amountPaid).toBe(100);
    expect(totals.balanceDue).toBe(150);
    expect(lastUpdate()).toMatchObject({ amountPaid: '100.00', balanceDue: '150.00' });
  });

  it('marks the invoice partially_paid while a balance remains', async () => {
    queueRecordPayment({ total: '100.00', alreadyPaid: '0', sumAfter: '30.00' });

    const { totals } = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 30, paymentDate: '2026-07-27',
    });

    expect(totals.status).toBe('partially_paid');
    expect(totals.paidAt).toBeNull();
    expect(lastUpdate().paidAt).toBeNull();
  });

  it('marks the invoice paid and stamps paid_at on full settlement', async () => {
    queueRecordPayment({ total: '100.00', alreadyPaid: '70.00', sumAfter: '100.00' });

    const { totals } = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 30, paymentDate: '2026-07-27',
    });

    expect(totals.status).toBe('paid');
    expect(totals.balanceDue).toBe(0);
    expect(totals.paidAt).toBeInstanceOf(Date);
  });

  it('records who entered the payment', async () => {
    queueRecordPayment({ total: '100.00', alreadyPaid: '0', sumAfter: '10.00' });

    await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 10, paymentDate: '2026-07-27', paymentMethod: 'bank_transfer', reference: 'TX-9',
    });

    const inserted = m.insertReturning.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      tenantId: TENANT,
      invoiceId: INVOICE,
      amount: '10.00',
      recordedBy: USER,
      paymentMethod: 'bank_transfer',
      reference: 'TX-9',
    });
  });

  it('rejects a zero or negative amount', async () => {
    for (const amount of [0, -5]) {
      await expect(
        recordInvoicePayment({
          invoiceId: INVOICE, tenantId: TENANT, userId: USER,
          amount, paymentDate: '2026-07-27',
        })
      ).rejects.toThrow(/greater than zero/);
    }
    // Rejected before any query runs.
    expect(m.db.transaction).not.toHaveBeenCalled();
  });

  it('rejects overpayment by default, with the outstanding balance in the message', async () => {
    queue(
      [{ id: INVOICE, status: 'sent', totalAmount: '100.00' }],
      [{ total: '90.00' }],
    );

    const err = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 25, paymentDate: '2026-07-27',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentError);
    expect((err as PaymentError).status).toBe(422);
    expect((err as Error).message).toContain('10.00');
    expect(m.insertReturning.mock.calls).toHaveLength(0);
  });

  it('permits overpayment when explicitly allowed, and skips the balance query', async () => {
    queue(
      [{ id: INVOICE, status: 'sent', totalAmount: '100.00' }],
      [{ totalAmount: '100.00', status: 'sent' }],
      [{ total: '130.00' }],
    );

    const { totals } = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 130, paymentDate: '2026-07-27', allowOverpayment: true,
    });

    expect(totals.amountPaid).toBe(130);
    expect(totals.balanceDue).toBe(-30);
    expect(totals.status).toBe('paid');
  });

  it('404s for an invoice outside the tenant', async () => {
    queue([]);

    const err = await recordInvoicePayment({
      invoiceId: 'other-tenant-invoice', tenantId: TENANT, userId: USER,
      amount: 10, paymentDate: '2026-07-27',
    }).catch((e: unknown) => e);

    expect((err as PaymentError).status).toBe(404);
  });

  it.each(['cancelled', 'void'])('refuses to record against a %s invoice', async (status) => {
    queue([{ id: INVOICE, status, totalAmount: '100.00' }]);

    const err = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 10, paymentDate: '2026-07-27',
    }).catch((e: unknown) => e);

    expect((err as PaymentError).status).toBe(409);
    expect(m.insertReturning.mock.calls).toHaveLength(0);
  });

  it('does not resurrect a non-payment status such as cancelled during recalc', async () => {
    // Reached via allowOverpayment so the guard is skipped; proves recalc only
    // moves status between payment-driven values.
    queue(
      [{ id: INVOICE, status: 'sent', totalAmount: '100.00' }],
      [{ totalAmount: '100.00', status: 'cancelled' }],
      [{ total: '100.00' }],
    );

    const { totals } = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 100, paymentDate: '2026-07-27', allowOverpayment: true,
    });

    expect(totals.status).toBe('cancelled');
  });

  it('rounds to cents so repeated addition cannot drift', async () => {
    queueRecordPayment({ total: '0.30', alreadyPaid: '0.20', sumAfter: '0.30000000000000004' });

    const { totals } = await recordInvoicePayment({
      invoiceId: INVOICE, tenantId: TENANT, userId: USER,
      amount: 0.1, paymentDate: '2026-07-27',
    });

    expect(totals.amountPaid).toBe(0.3);
    expect(totals.balanceDue).toBe(0);
    expect(lastUpdate().balanceDue).toBe('0.00');
  });
});

describe('voidInvoicePayment', () => {
  it('soft-deletes the payment and recomputes the summary', async () => {
    queue(
      [{ id: 'pay-1' }], // payment lookup
      [{ totalAmount: '100.00', status: 'paid' }], // recalc invoice
      [{ total: '40.00' }], // remaining ledger
    );

    const totals = await voidInvoicePayment({
      invoiceId: INVOICE, paymentId: 'pay-1', tenantId: TENANT, userId: USER,
    });

    // Soft delete, not a hard delete: the reversal stays in the history.
    const softDelete = m.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(softDelete.deletedAt).toBeInstanceOf(Date);
    expect(softDelete.deletedBy).toBe(USER);

    expect(totals.amountPaid).toBe(40);
    expect(totals.balanceDue).toBe(60);
    expect(totals.status).toBe('partially_paid');
  });

  it('reopens a fully-paid invoice when its last payment is voided', async () => {
    queue(
      [{ id: 'pay-1' }],
      [{ totalAmount: '100.00', status: 'paid' }],
      [{ total: '0' }],
    );

    const totals = await voidInvoicePayment({
      invoiceId: INVOICE, paymentId: 'pay-1', tenantId: TENANT, userId: USER,
    });

    expect(totals.amountPaid).toBe(0);
    expect(totals.status).toBe('sent');
    // paid_at must be cleared, or the invoice claims a settlement date it no
    // longer has.
    expect(totals.paidAt).toBeNull();
    expect(lastUpdate().paidAt).toBeNull();
  });

  it('404s for a payment that is not on this invoice or already voided', async () => {
    queue([]);

    const err = await voidInvoicePayment({
      invoiceId: INVOICE, paymentId: 'nope', tenantId: TENANT, userId: USER,
    }).catch((e: unknown) => e);

    expect((err as PaymentError).status).toBe(404);
    expect(m.updateSet).not.toHaveBeenCalled();
  });
});
