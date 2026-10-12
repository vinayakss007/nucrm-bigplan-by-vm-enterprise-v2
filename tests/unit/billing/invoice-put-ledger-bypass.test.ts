/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2226 — invoice PUT must not bypass the payment ledger.
 *
 * Before the fix, PUT /api/tenant/invoices/:id accepted status:'paid'
 * (with zero payments recorded, auto-stamping paidAt) and edited amount
 * fields without recomputing amountPaid/balanceDue, so revenue rows could
 * silently drift from the invoice_payments ledger.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { state, tx, db, mockRequireAuth, mockRequirePerm, mockLogAudit, mockRecalc } =
  vi.hoisted(() => {
    const state = {
      selectRows: [] as unknown[],
      updateRows: [] as unknown[],
      txSelectRows: [] as unknown[],
      txUpdateRows: [] as unknown[],
      txCalls: 0,
      dbUpdateCalls: 0,
      txUpdateCalls: 0,
    };

    /** Passthrough drizzle chain whose terminal call resolves `rows`. */
    function chain(rows: () => unknown[], terminal: 'limit' | 'returning') {
      const self: Record<string, unknown> = {
        from: () => self,
        where: () => self,
        set: () => self,
        then: (res: (v: unknown) => unknown) => Promise.resolve(rows()).then(res),
      };
      self[terminal === 'limit' ? 'limit' : 'returning'] = () => Promise.resolve(rows());
      return self;
    }

    const tx = {
      update: () => {
        state.txUpdateCalls++;
        return chain(() => state.txUpdateRows, 'returning');
      },
      select: () => chain(() => state.txSelectRows, 'limit'),
    };

    const db = {
      select: () => chain(() => state.selectRows, 'limit'),
      update: () => {
        state.dbUpdateCalls++;
        return chain(() => state.updateRows, 'returning');
      },
      transaction: async (cb: (t: typeof tx) => Promise<unknown>) => {
        state.txCalls++;
        return cb(tx);
      },
    };

    return {
      state,
      tx,
      db,
      mockRequireAuth: vi.fn(),
      mockRequirePerm: vi.fn(),
      mockLogAudit: vi.fn(),
      mockRecalc: vi.fn(),
    };
  });

vi.mock('@/drizzle/db', () => ({ db }));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  requirePerm: (...args: unknown[]) => mockRequirePerm(...args),
  requireCsrf: () => null,
}));

vi.mock('@/lib/audit', () => ({ logAudit: (...args: unknown[]) => mockLogAudit(...args) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn().mockResolvedValue(null),
}));

// Unit tests have no DB to pin a connection against (repo convention).
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));

// The ledger recalculation itself is covered by tests/unit/billing/invoice-payments.test.ts;
// here we only assert the route INVOKES it, inside a transaction, when money changes.
vi.mock('@/lib/billing/payments', () => ({
  recalculateInvoicePayments: (...args: unknown[]) => mockRecalc(...args),
}));

const TENANT_ID = 'test-tenant-001';

function putInvoice(body: Record<string, unknown>) {
  const req = new Request('http://localhost:3000/api/tenant/invoices/inv-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'session=test' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return import('@/app/api/tenant/invoices/[id]/route').then(({ PUT }) =>
    PUT(req, { params: Promise.resolve({ id: 'inv-1' }) })
  );
}

describe('PUT /api/tenant/invoices/[id] — ledger bypass (#2226)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.selectRows = [{ id: 'inv-1' }];
    state.updateRows = [{ id: 'inv-1', status: 'sent' }];
    state.txUpdateRows = [{ id: 'inv-1', totalAmount: '900.00' }];
    state.txSelectRows = [{ id: 'inv-1', totalAmount: '900.00', amountPaid: '500.00', balanceDue: '400.00', status: 'partially_paid' }];
    state.txCalls = 0;
    state.dbUpdateCalls = 0;
    state.txUpdateCalls = 0;
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'user-1' });
    mockRequirePerm.mockReturnValue(null);
    mockLogAudit.mockResolvedValue(undefined);
    mockRecalc.mockResolvedValue({ totalAmount: 900, amountPaid: 500, balanceDue: 400, status: 'partially_paid', paidAt: null });
  });

  it("rejects status:'paid' with 422 and writes nothing", async () => {
    const res = await putInvoice({ status: 'paid' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('payment ledger');
    expect(body.error).toContain('/payments');
    expect(state.dbUpdateCalls).toBe(0);
    expect(state.txUpdateCalls).toBe(0);
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("rejects status:'partially_paid' with 422", async () => {
    const res = await putInvoice({ status: 'partially_paid' });
    expect(res.status).toBe(422);
    expect(state.dbUpdateCalls).toBe(0);
  });

  it('recomputes the summary via recalculateInvoicePayments inside a tx when amounts change', async () => {
    const res = await putInvoice({ totalAmount: '900.00' });
    expect(res.status).toBe(200);
    expect(state.txCalls).toBe(1);
    expect(state.dbUpdateCalls).toBe(0);
    expect(mockRecalc).toHaveBeenCalledTimes(1);
    const [recalcTx, invoiceId, tenantId] = mockRecalc.mock.calls[0];
    expect(recalcTx).toBe(tx);
    expect(invoiceId).toBe('inv-1');
    expect(tenantId).toBe(TENANT_ID);
    // Response reflects the recomputed row, not the pre-recalc RETURNING row.
    const body = await res.json();
    expect(body.data.balanceDue).toBe('400.00');
    expect(body.data.status).toBe('partially_paid');
  });

  it('still accepts lifecycle statuses (sent) without touching the ledger path', async () => {
    const res = await putInvoice({ status: 'sent' });
    expect(res.status).toBe(200);
    expect(state.dbUpdateCalls).toBe(1);
    expect(state.txCalls).toBe(0);
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it('non-monetary edits (title) keep the plain update path', async () => {
    const res = await putInvoice({ title: 'Updated Invoice' });
    expect(res.status).toBe(200);
    expect(state.dbUpdateCalls).toBe(1);
    expect(state.txCalls).toBe(0);
    expect(mockRecalc).not.toHaveBeenCalled();
  });

  it('rejects hand-set derived amounts as before (regression guard)', async () => {
    const res = await putInvoice({ amountPaid: '999.00' });
    expect(res.status).toBe(422);
    expect(state.dbUpdateCalls).toBe(0);
  });
});
