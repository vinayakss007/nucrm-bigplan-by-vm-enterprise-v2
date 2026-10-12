/**
 * #2258 — invoice status vocabulary: Zod, the PUT route gate and the DB CHECK
 * must agree, and nothing schema-valid may ever reach 23514.
 *
 * Before the fix, `{"status":"void"}` / `{"status":"refunded"}` passed
 * createInvoiceSchema but chk_invoices_status rejected them on INSERT/UPDATE
 * (guaranteed 500 pre-#2131 mapping, opaque 400 after). Meanwhile the
 * DB-legal 'written_off'/'pending' were unaddressable through the API, and
 * PUT /api/tenant/invoices/[id] validated status against nothing at all.
 *
 * Decisions asserted here (per value, see INVOICE_STATUSES in
 * lib/api/schemas/billing.ts):
 *   void         → real product state (payments + PayU webhook guard on it):
 *                  accepted by Zod AND now legal in the DB (migration 0112).
 *   refunded     → not an invoice status (refunds are ledger entries): removed
 *                  from Zod, rejected by the PUT route — 400 with the allowed
 *                  list, never a DB touch.
 *   written_off,
 *   pending      → DB-legal legacy values: added to Zod/route vocabulary.
 *   banana       → unknown value: 400 from Zod pre-validation on POST and
 *                  from the PUT route gate; never 500/23514.
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

const VALID_BASE = {
  contact_id: '00000000-0000-0000-0000-000000000000',
  company_id: '00000000-0000-0000-0000-000000000000',
  line_items: [{ description: 'Services', quantity: 1, unit_price: 100 }],
};

describe('invoice status vocabulary (#2258) — Zod schemas', () => {
  it.each(['draft', 'sent', 'paid', 'overdue', 'cancelled', 'partially_paid', 'written_off', 'pending', 'void'] as const)(
    "createInvoiceSchema accepts '%s' (value chk_invoices_status allows after 0112)",
    async (status) => {
      const { createInvoiceSchema } = await import('@/lib/api/schemas');
      const result = createInvoiceSchema.parse({ ...VALID_BASE, status });
      expect(result.status).toBe(status);
    },
  );

  it("createInvoiceSchema REJECTS 'refunded' — a 400 here is what keeps 23514 out of the DB", async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    expect(() => createInvoiceSchema.parse({ ...VALID_BASE, status: 'refunded' })).toThrow();
  });

  it("createInvoiceSchema rejects an unknown status with a message naming the allowed values", async () => {
    const { createInvoiceSchema } = await import('@/lib/api/schemas');
    const result = createInvoiceSchema.safeParse({ ...VALID_BASE, status: 'banana' });
    expect(result.success).toBe(false);
    const issue = (result as { error: { issues: Array<{ code: string; message: string; path: unknown[] }> } })
      .error.issues.find((i) => i.path[0] === 'status');
    expect(issue?.code).toBe('invalid_value');
    // The rejection itself teaches the client the vocabulary — no opaque DB error.
    expect(issue?.message).toMatch(/void/);
    expect(issue?.message).toMatch(/written_off/);
  });

  it("updateInvoiceSchema mirrors createInvoiceSchema (partial of the same enum)", async () => {
    const { updateInvoiceSchema } = await import('@/lib/api/schemas');
    expect(updateInvoiceSchema.parse({ status: 'void' }).status).toBe('void');
    expect(updateInvoiceSchema.parse({ status: 'written_off' }).status).toBe('written_off');
    expect(() => updateInvoiceSchema.parse({ status: 'refunded' })).toThrow();
    expect(() => updateInvoiceSchema.parse({ status: 'banana' })).toThrow();
  });

  it('the split billing module exposes the identical vocabulary (no second enum to drift)', async () => {
    const monolith = await import('@/lib/api/schemas');
    const split = await import('@/lib/api/schemas/billing');
    const { INVOICE_STATUSES } = split;
    for (const status of [...INVOICE_STATUSES, 'refunded', 'banana']) {
      const m = monolith.createInvoiceSchema.safeParse({ ...VALID_BASE, status }).success;
      const s = split.createInvoiceSchema.safeParse({ ...VALID_BASE, status }).success;
      expect(m, `monolith vs split disagree on '${status}'`).toBe(s);
    }
    expect(INVOICE_STATUSES).not.toContain('refunded');
  });
});

describe('PUT /api/tenant/invoices/[id] — status gate (#2258)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.selectRows = [{ id: 'inv-1' }];
    state.updateRows = [{ id: 'inv-1', status: 'void' }];
    state.txUpdateRows = [];
    state.txSelectRows = [];
    state.txCalls = 0;
    state.dbUpdateCalls = 0;
    state.txUpdateCalls = 0;
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'user-1' });
    mockRequirePerm.mockReturnValue(null);
    mockLogAudit.mockResolvedValue(undefined);
    mockRecalc.mockResolvedValue({});
  });

  it("rejects 'banana' with 400 naming the allowed values and never touches the DB", async () => {
    const res = await putInvoice({ status: 'banana' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('banana');
    expect(body.error).toContain('void');
    expect(body.error).toContain('written_off');
    expect(state.dbUpdateCalls).toBe(0);
    expect(state.txCalls).toBe(0);
  });

  it("rejects 'refunded' with 400 (the old 23514 payload) without a DB write", async () => {
    const res = await putInvoice({ status: 'refunded' });
    expect(res.status).toBe(400);
    expect(state.dbUpdateCalls).toBe(0);
  });

  it("accepts 'void' — the vocabulary the 0112 CHECK now legalises — and updates", async () => {
    const res = await putInvoice({ status: 'void' });
    expect(res.status).toBe(200);
    expect(state.dbUpdateCalls).toBe(1);
  });

  it("keeps the #2226 ledger ownership: 'paid' is still 422, not relabelled 400", async () => {
    const res = await putInvoice({ status: 'paid' });
    expect(res.status).toBe(422);
    expect(state.dbUpdateCalls).toBe(0);
  });
});
