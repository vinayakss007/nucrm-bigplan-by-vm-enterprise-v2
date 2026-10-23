/**
 * #3142 — recalculateInvoicePayments() re-stamped paidAt to now() on every
 * recalc that left an invoice fully paid, so editing a paid invoice or a
 * replayed PayU webhook silently moved the settlement date the public portal
 * serves. The existing paidAt must survive the paid state and only be stamped
 * on the unpaid→paid transition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  invoiceRow: undefined as Record<string, unknown> | undefined,
  ledgerSum: '0',
  setValues: undefined as Record<string, unknown> | undefined,
}));

// The recalc issues two shaped selects on the same transaction handle:
//   .select({totalAmount, status, paidAt}) … and .select({total: SUM(...)})
// The mock answers by the requested column shape, like a real PgSelect would.
function makeTx() {
  return {
    select: (cols: Record<string, unknown>) => {
      const rows =
        'total' in cols
          ? [{ total: state.ledgerSum }]
          : state.invoiceRow ? [state.invoiceRow] : [];
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
      };
      chain.limit = () => Promise.resolve(rows);
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
      return chain;
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        state.setValues = vals;
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
}

import { recalculateInvoicePayments } from '@/lib/billing/payments';

beforeEach(() => {
  state.invoiceRow = undefined;
  state.ledgerSum = '0';
  state.setValues = undefined;
});

describe('#3142 recalculateInvoicePayments preserves the settlement stamp', () => {
  const OLD = new Date('2026-01-15T09:30:00Z');

  it('keeps the original paidAt when a recalc leaves the invoice fully paid', async () => {
    state.invoiceRow = { totalAmount: '100.00', status: 'paid', paidAt: OLD };
    state.ledgerSum = '100.00';
    const res = await recalculateInvoicePayments(makeTx() as never, 'inv-1', 'tenant-1');
    expect(res.status).toBe('paid');
    expect(state.setValues?.paidAt).toBe(OLD);
  });

  it('stamps paidAt only on the unpaid → paid transition', async () => {
    state.invoiceRow = { totalAmount: '100.00', status: 'partially_paid', paidAt: null };
    state.ledgerSum = '100.00';
    const before = Date.now();
    const res = await recalculateInvoicePayments(makeTx() as never, 'inv-1', 'tenant-1');
    expect(res.status).toBe('paid');
    const stamp = state.setValues?.paidAt as Date;
    expect(stamp).toBeInstanceOf(Date);
    expect(stamp.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('clears paidAt when a refund reopens the balance', async () => {
    state.invoiceRow = { totalAmount: '100.00', status: 'paid', paidAt: OLD };
    state.ledgerSum = '40.00';
    const res = await recalculateInvoicePayments(makeTx() as never, 'inv-1', 'tenant-1');
    expect(res.status).toBe('partially_paid');
    expect(state.setValues?.paidAt).toBeNull();
  });
});
