/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2289 — updateInvoicePayment(): the PATCH path for a mis-keyed ledger
 * payment (previously the only fix was void + re-record).
 *
 * Properties protected here, mirroring tests/unit/billing/invoice-payments.test.ts:
 *  - the edit and the invoice-summary recompute run in ONE transaction;
 *  - the summary is DERIVED from the ledger (never trusted from the caller);
 *  - raising a payment past the balance is rejected (422) unless
 *    allow_overpayment, same policy as recordInvoicePayment;
 *  - a reference collision (unique index 23505) answers 409, not 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => {
  /** Queue of results for successive select() chains, in call order. */
  const selects: unknown[][] = [];
  const next = (): unknown[] => (selects.length ? (selects.shift() as unknown[]) : []);

  const updateSet = vi.fn();
  /** Rows returned (in order) by update()...returning(); [] when exhausted. */
  const updateReturning: unknown[][] = [];
  const state = { updateErrorCode: null as string | null, updateCallCount: 0 };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(next()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (ok: any, err: any) => Promise.resolve(next()).then(ok, err);

  chain.update = vi.fn(() => {
    state.updateCallCount += 1;
    return {
      set: (values: unknown) => {
        updateSet(values);
        return {
          where: () => ({
            returning: () => {
              if (state.updateErrorCode) {
                const err = new Error('duplicate key');
                (err as unknown as { code: string }).code = state.updateErrorCode;
                return Promise.reject(err);
              }
              return Promise.resolve(updateReturning.shift() ?? []);
            },
          }),
        };
      },
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.transaction = vi.fn(async (cb: any) => cb(chain));

  return { db: chain, selects, updateSet, updateReturning, state };
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
    paymentMethod: 'invoice_payments.payment_method',
    reference: 'invoice_payments.reference',
    notes: 'invoice_payments.notes',
    deletedAt: 'invoice_payments.deleted_at',
    deletedBy: 'invoice_payments.deleted_by',
    updatedAt: 'invoice_payments.updated_at',
    updatedBy: 'invoice_payments.updated_by',
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

import { updateInvoicePayment, PaymentError } from '@/lib/billing/payments';

const TENANT = 'tenant-1';
const USER = 'user-1';
const INVOICE = 'inv-1';
const PAYMENT = 'pay-1';

function queue(...results: unknown[][]): void {
  m.selects.push(...results);
}

const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: PAYMENT,
  tenantId: TENANT,
  invoiceId: INVOICE,
  amount: '100.00',
  paymentDate: '2026-09-01',
  deletedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.selects.length = 0;
  m.updateReturning.length = 0;
  m.state.updateErrorCode = null;
  m.state.updateCallCount = 0;
});

describe('updateInvoicePayment — #2289 PATCH ledger path', () => {
  it('patches the ledger row and recomputes the summary in one transaction', async () => {
    // selects: payment lookup, recalc invoice, recalc sum
    queue([paymentRow()], [{ totalAmount: '500.00', status: 'sent' }], [{ total: '100.00' }]);
    m.updateReturning.push([{ ...paymentRow(), amount: '100.00', notes: 'wire fix' }]);

    const { payment, totals } = await updateInvoicePayment({
      invoiceId: INVOICE,
      paymentId: PAYMENT,
      tenantId: TENANT,
      userId: USER,
      amount: 100,
      notes: 'wire fix',
    });

    expect(m.db.transaction).toHaveBeenCalledTimes(1);
    // 1st update = the ledger row, 2nd = the derived summary.
    expect(m.state.updateCallCount).toBe(2);
    const ledgerPatch = m.updateSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ledgerPatch.amount).toBe('100.00');
    expect(ledgerPatch.notes).toBe('wire fix');
    expect(ledgerPatch.updatedBy).toBe(USER);
    expect(ledgerPatch.updatedAt).toBeInstanceOf(Date);
    const summary = m.updateSet.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(summary).toMatchObject({ amountPaid: '100.00', balanceDue: '400.00', status: 'partially_paid' });
    expect(payment).toMatchObject({ id: PAYMENT });
    expect(totals).toMatchObject({ totalAmount: 500, amountPaid: 100, balanceDue: 400, status: 'partially_paid' });
  });

  it('rejects an edit that takes the invoice past its total unless allow_overpayment', async () => {
    queue([paymentRow()], [{ totalAmount: '500.00', status: 'partially_paid' }], [{ total: '600.00' }]);
    m.updateReturning.push([{ ...paymentRow(), amount: '600.00' }]);

    await expect(
      updateInvoicePayment({
        invoiceId: INVOICE,
        paymentId: PAYMENT,
        tenantId: TENANT,
        userId: USER,
        amount: 600,
      })
    ).rejects.toMatchObject({ name: 'PaymentError', status: 422 });

    queue([paymentRow()], [{ totalAmount: '500.00', status: 'partially_paid' }], [{ total: '600.00' }]);
    m.updateReturning.push([{ ...paymentRow(), amount: '600.00' }]);
    const res = await updateInvoicePayment({
      invoiceId: INVOICE,
      paymentId: PAYMENT,
      tenantId: TENANT,
      userId: USER,
      amount: 600,
      allowOverpayment: true,
    });
    expect(res.totals).toMatchObject({ balanceDue: -100, status: 'paid' });
    expect(res.totals.paidAt).toBeInstanceOf(Date);
  });

  it('answers 404 when the payment is not in this tenant (or already voided)', async () => {
    queue([]); // tenant-scoped + live-row select found nothing

    await expect(
      updateInvoicePayment({
        invoiceId: INVOICE,
        paymentId: PAYMENT,
        tenantId: TENANT,
        userId: USER,
        notes: 'cross-tenant attempt',
      })
    ).rejects.toBeInstanceOf(PaymentError);

    expect(m.state.updateCallCount).toBe(0);
  });

  it('maps a reference collision (23505) to 409, not a 500', async () => {
    queue([paymentRow()]);
    m.state.updateErrorCode = '23505';

    await expect(
      updateInvoicePayment({
        invoiceId: INVOICE,
        paymentId: PAYMENT,
        tenantId: TENANT,
        userId: USER,
        reference: 'DUP-1',
      })
    ).rejects.toMatchObject({ name: 'PaymentError', status: 409 });
  });

  it('refuses a non-positive amount before opening a transaction', async () => {
    await expect(
      updateInvoicePayment({
        invoiceId: INVOICE,
        paymentId: PAYMENT,
        tenantId: TENANT,
        userId: USER,
        amount: 0,
      })
    ).rejects.toMatchObject({ name: 'PaymentError', status: 400 });

    expect(m.db.transaction).not.toHaveBeenCalled();
  });
});
