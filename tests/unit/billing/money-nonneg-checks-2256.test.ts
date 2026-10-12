/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2256 — revenue money columns must reject negative amounts with 400.
 *
 * The audit reproduced `INSERT INTO invoices (..., subtotal, balance_due)
 * VALUES (..., -99999.99, -50000)` being ACCEPTED at the DB level. This suite
 * locks the app half of the fix:
 *   * PUT /api/tenant/invoices/:id   — negative subtotal/discountValue/
 *     discountAmount/taxAmount/totalAmount/taxRate, and taxRate > 100 → 400
 *   * PUT /api/tenant/quotes/:id     — negative subtotal/tax/discount → 400
 *   * PUT /api/tenant/orders/:id     — negative subtotal/totalAmount → 400
 *   * PUT /api/tenant/contracts/:id  — negative totalValue → 400
 *   * Zod create payloads — money fields already carried min(0); these
 *     assertions pin that so a future edit cannot silently drop it.
 * Positive controls prove legit non-negative updates still succeed.
 *
 * The DB half (0111_money_check_constraints.sql CHECK (col >= 0) / <= 100)
 * is NOT exercised here — CI uses drizzle-kit push, which does not apply
 * hand-written SQL migrations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { state, db, mockRequireAuth, mockRequirePerm, mockLogAudit, mockRecalc } =
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

vi.mock('@/lib/billing/payments', () => ({
  recalculateInvoicePayments: (...args: unknown[]) => mockRecalc(...args),
}));

const TENANT_ID = 'test-tenant-001';
const UPDATED_AT = new Date('2026-01-01T00:00:00Z');

function put(base: string, id: string, body: Record<string, unknown>) {
  const req = new Request(`http://localhost:3000/api/tenant/${base}/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie: 'session=test' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return import(`@/app/api/tenant/${base}/[id]/route`).then(({ PUT }) =>
    PUT(req, { params: Promise.resolve({ id }) })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.selectRows = [{ id: 'row-1', updatedAt: UPDATED_AT, status: 'draft', totalAmount: '900.00' }];
  state.updateRows = [{ id: 'row-1', updatedAt: UPDATED_AT }];
  state.txUpdateRows = [{ id: 'row-1', totalAmount: '900.00' }];
  state.txSelectRows = [{ id: 'row-1', totalAmount: '900.00', amountPaid: '500.00', balanceDue: '400.00', status: 'partially_paid' }];
  state.txCalls = 0;
  state.dbUpdateCalls = 0;
  state.txUpdateCalls = 0;
  mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'user-1' });
  mockRequirePerm.mockReturnValue(null);
  mockLogAudit.mockResolvedValue(undefined);
  mockRecalc.mockResolvedValue({ totalAmount: 900, amountPaid: 500, balanceDue: 400, status: 'partially_paid', paidAt: null });
});

describe('PUT /api/tenant/invoices/[id] — negative money rejected (#2256)', () => {
  it('rejects subtotal: -99999.99 with 400 and writes nothing', async () => {
    const res = await put('invoices', 'inv-1', { subtotal: '-99999.99' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('non-negative');
    expect(state.dbUpdateCalls).toBe(0);
    expect(state.txUpdateCalls).toBe(0);
  });

  it('rejects negative taxRate, discountValue, taxAmount and discountAmount with 400', async () => {
    for (const field of ['taxRate', 'discountValue', 'taxAmount', 'discountAmount', 'totalAmount'] as const) {
      const res = await put('invoices', 'inv-1', { [field]: -5 });
      expect(res.status, field).toBe(400);
      expect((await res.json()).error).toContain('non-negative');
    }
    expect(state.dbUpdateCalls).toBe(0);
  });

  it('rejects taxRate above 100 (mirrors chk_invoices_tax_rate_max100) with 400', async () => {
    const res = await put('invoices', 'inv-1', { taxRate: 150 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('at most 100');
  });

  it('still accepts a legitimate non-negative subtotal update', async () => {
    const res = await put('invoices', 'inv-1', { subtotal: '500.00' });
    expect(res.status).toBe(200);
    // Money fields affect the ledger summary → recomputed in a tx (#2226 path).
    expect(state.txCalls).toBe(1);
    expect(mockRecalc).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/tenant/quotes/[id] — negative money rejected (#2256)', () => {
  it('rejects negative subtotal / tax / discount / totalAmount with 400', async () => {
    for (const field of ['subtotal', 'tax', 'discount', 'totalAmount'] as const) {
      const res = await put('quotes', 'q-1', { [field]: -1000 });
      expect(res.status, field).toBe(400);
      expect((await res.json()).error).toContain('non-negative');
    }
    expect(state.dbUpdateCalls).toBe(0);
  });

  it('still accepts a legitimate non-negative subtotal update', async () => {
    const res = await put('quotes', 'q-1', { subtotal: '500.00' });
    expect(res.status).toBe(200);
    expect(state.dbUpdateCalls).toBe(1);
  });
});

describe('PUT /api/tenant/orders/[id] — negative money rejected (#2256)', () => {
  it('rejects negative subtotal / totalAmount / discount with 400', async () => {
    for (const field of ['subtotal', 'totalAmount', 'discount'] as const) {
      const res = await put('orders', 'o-1', { [field]: -250 });
      expect(res.status, field).toBe(400);
      expect((await res.json()).error).toContain('non-negative');
    }
  });
});

describe('PUT /api/tenant/contracts/[id] — negative value rejected (#2256)', () => {
  it('rejects totalValue: -10 with 400', async () => {
    const res = await put('contracts', 'c-1', { totalValue: '-10' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('non-negative');
    expect(state.dbUpdateCalls).toBe(0);
  });
});

describe('Zod create/update payloads keep min(0) on money fields (#2256)', () => {
  it('createInvoiceSchema rejects negative discount, tax_rate and line items', async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    const base = {
      contact_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      company_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      line_items: [{ description: 'x', quantity: 1, unit_price: 10 }],
    };
    expect(createInvoiceSchema.safeParse({ ...base, discount: -5 }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, tax_rate: -1 }).success).toBe(false);
    expect(
      createInvoiceSchema.safeParse({
        ...base,
        line_items: [{ description: 'x', quantity: 1, unit_price: -10 }],
      }).success,
    ).toBe(false);
    expect(
      createInvoiceSchema.safeParse({
        ...base,
        line_items: [{ description: 'x', quantity: 1, unit_price: 10, tax_rate: 120 }],
      }).success,
    ).toBe(false);
    expect(createInvoiceSchema.safeParse(base).success).toBe(true);
  });

  it('createQuoteSchema rejects negative discount and line values', async () => {
    const { createQuoteSchema } = await import('@/lib/api/schemas');
    const base = {
      contact_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      company_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      title: 'Q',
      line_items: [{ description: 'x', quantity: 1, unit_price: 10 }],
    };
    expect(createQuoteSchema.safeParse({ ...base, discount: -0.01 }).success).toBe(false);
    expect(createQuoteSchema.safeParse(base).success).toBe(true);
  });

  it('createLeadSchema and createContractSchema reject negative value', async () => {
    const { createLeadSchema, createContractSchema } = await import('@/lib/api/schemas');
    const leadBase = { first_name: 'A' };
    expect(createLeadSchema.safeParse({ ...leadBase, value: -1 }).success).toBe(false);
    expect(createLeadSchema.safeParse({ ...leadBase, value: 0 }).success).toBe(true);

    const contractBase = {
      title: 'C',
      contact_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      company_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    };
    expect(createContractSchema.safeParse({ ...contractBase, value: -1 }).success).toBe(false);
    expect(createContractSchema.safeParse({ ...contractBase, value: 100 }).success).toBe(true);
  });

  it('submodule billing schema mirrors the monolith guards (drift guard #1883)', async () => {
    const { createInvoiceSchema: mono } = await import('@/lib/api/schemas');
    const { createInvoiceSchema: sub } = await import('@/lib/api/schemas/billing');
    const bad = {
      contact_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      company_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      line_items: [{ description: 'x', quantity: 1, unit_price: 10 }],
      discount: -5,
    };
    expect(mono.safeParse(bad).success).toBe(false);
    expect(sub.safeParse(bad).success).toBe(false);
  });
});
