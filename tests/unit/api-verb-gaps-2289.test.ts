/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2289 — verb gaps on tenant CRUD routes (route wiring).
 *
 *  - PATCH /api/tenant/quotes/[id]        was 405 while PUT worked
 *  - PATCH /api/tenant/invoices/[id]      was 405 while PUT worked
 *  - PATCH /api/tenant/invoices/[id]/payments/[paymentId]  had no update verb at all
 *  - GET   /api/tenant/tasks/[id]         was 405 (no detail read)
 *
 * New handlers answer in the canonical `{ data }` envelope
 * (lib/api/response-envelope) and errors go through apiError. The ledger
 * recomputation inside updateInvoicePayment() is covered by
 * tests/unit/billing/payment-update-ledger.test.ts; here the payments lib is
 * mocked so these cases assert the route wiring only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const USER = 'b2222222-2222-4222-8222-222222222222';
const QUOTE_ID = 'c3333333-3333-4333-8333-333333333333';
const INVOICE_ID = 'd4444444-4444-4444-8444-444444444444';
const TASK_ID = 'e5555555-5555-4555-8555-555555555555';
const PAYMENT_ID = 'f6666666-6666-4666-8666-666666666666';

const harness = vi.hoisted(() => {
  const state = {
    rows: [] as unknown[],
    selectQueue: [] as unknown[][],
    setPayloads: [] as Record<string, unknown>[],
    updateCount: 0,
    txCalls: 0,
    txUpdateRows: [] as unknown[],
    txSelectRows: [] as unknown[],
  };
  /** Passthrough drizzle chain; terminal calls resolve the harness rows. */
  const chain = (resolve: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => Promise.resolve(resolve());
    c.returning = () => Promise.resolve(resolve());
    c.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(ok, err);
    return c;
  };
  const tx: Record<string, unknown> = {
    update: () => {
      state.txCalls += 1;
      const c: Record<string, unknown> = {};
      c.set = (payload: Record<string, unknown>) => {
        state.setPayloads.push(payload);
        return c;
      };
      c.where = () => chain(() => state.txUpdateRows);
      return c;
    },
    select: () => chain(() => state.txSelectRows),
  };
  const db = {
    select: vi.fn(() => {
      const next = state.selectQueue.shift();
      return chain(() => next ?? state.rows);
    }),
    update: vi.fn(() => {
      state.updateCount += 1;
      const c: Record<string, unknown> = {};
      c.set = (payload: Record<string, unknown>) => {
        state.setPayloads.push(payload);
        return c;
      };
      c.where = () => chain(() => state.rows);
      return c;
    }),
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  };
  const mockRequireAuth = vi.fn();
  const mockRequirePerm = vi.fn();
  const mockRequireCsrf = vi.fn();
  const mockCan = vi.fn();
  const mockLogAudit = vi.fn();
  const paymentsStub = {
    recalculateInvoicePayments: vi.fn(async () => undefined),
    voidInvoicePayment: vi.fn(),
    updateInvoicePayment: vi.fn(),
    PaymentError: class PaymentError extends Error {
      constructor(
        message: string,
        readonly status: number
      ) {
        super(message);
        this.name = 'PaymentError';
      }
    },
  };
  return { state, db, mockRequireAuth, mockRequirePerm, mockRequireCsrf, mockCan, mockLogAudit, paymentsStub };
});

vi.mock('@/drizzle/db', () => ({ db: harness.db }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (...args: unknown[]) => harness.mockRequireAuth(...args),
  requirePerm: (...args: unknown[]) => harness.mockRequirePerm(...args),
  requireCsrf: (...args: unknown[]) => harness.mockRequireCsrf(...args),
  can: (...args: unknown[]) => harness.mockCan(...args),
}));
// Session-level mocks per repo test convention: both token verification
// entry points are exported so any transitive session import resolves.
vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(async () => null),
  getCurrentUserForToken: vi.fn(async () => null),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: (...args: unknown[]) => harness.mockLogAudit(...args) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn(async () => undefined) }));
// Unit tests have no DB to pin a connection against (repo convention).
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
// Keep the real ConcurrencyError exports (api-error.ts instanceof-checks them);
// only the compare-and-swap wrapper is short-circuited.
vi.mock('@/lib/concurrency', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/concurrency')>()),
  withConcurrencyGuard: async (fn: () => Promise<unknown[]>) => fn(),
}));
vi.mock('@/lib/billing/payments', () => harness.paymentsStub);

import * as quotesRoute from '@/app/api/tenant/quotes/[id]/route';
import * as invoicesRoute from '@/app/api/tenant/invoices/[id]/route';
import * as tasksRoute from '@/app/api/tenant/tasks/[id]/route';
import * as paymentsRoute from '@/app/api/tenant/invoices/[id]/payments/[paymentId]/route';

function request(method: string, url: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.state.rows = [];
  harness.state.selectQueue = [];
  harness.state.setPayloads = [];
  harness.state.updateCount = 0;
  harness.state.txCalls = 0;
  harness.state.txUpdateRows = [];
  harness.state.txSelectRows = [];
  harness.mockRequireAuth.mockResolvedValue({ tenantId: TENANT, userId: USER });
  harness.mockRequirePerm.mockReturnValue(null);
  harness.mockRequireCsrf.mockReturnValue(null);
  harness.mockCan.mockReturnValue(false);
  harness.mockLogAudit.mockResolvedValue(undefined);
});

describe('PATCH /api/tenant/quotes/[id] — verb gap (#2289)', () => {
  it('exposes PATCH as the very same handler as the working PUT', () => {
    expect(typeof quotesRoute.PATCH).toBe('function');
    expect(quotesRoute.PATCH).toBe(quotesRoute.PUT);
  });

  it('applies a partial body and answers { data }', async () => {
    harness.state.selectQueue = [[{ id: QUOTE_ID, updatedAt: new Date() }]];
    harness.state.rows = [{ id: QUOTE_ID, title: 'Renewed' }];

    const res = await quotesRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/quotes/${QUOTE_ID}`, { title: 'Renewed' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(QUOTE_ID);
    expect(harness.state.setPayloads[0]).toMatchObject({ title: 'Renewed', updatedBy: USER });
    expect(harness.mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it('keeps PUT answers for a trashed/foreign row at 404', async () => {
    harness.state.selectQueue = [[]];
    const res = await quotesRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/quotes/${QUOTE_ID}`, { title: 'Ghost' }),
      { params: Promise.resolve({ id: QUOTE_ID }) }
    );
    expect(res.status).toBe(404);
    expect(harness.state.updateCount).toBe(0);
  });
});

describe('PATCH /api/tenant/invoices/[id] — verb gap (#2289)', () => {
  it('exposes PATCH as the very same handler as the working PUT', () => {
    expect(typeof invoicesRoute.PATCH).toBe('function');
    expect(invoicesRoute.PATCH).toBe(invoicesRoute.PUT);
  });

  it('applies a partial body through the shared handler, CSRF-checked', async () => {
    harness.state.selectQueue = [[{ id: INVOICE_ID }]];
    harness.state.rows = [{ id: INVOICE_ID, title: 'Invoice 7' }];

    const res = await invoicesRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/invoices/${INVOICE_ID}`, { title: 'Invoice 7' }),
      { params: Promise.resolve({ id: INVOICE_ID }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(INVOICE_ID);
    expect(harness.mockRequireCsrf).toHaveBeenCalled();
    // Non-money field: the #2226 ledger recompute must NOT run.
    expect(harness.paymentsStub.recalculateInvoicePayments).not.toHaveBeenCalled();
  });

  it('inherits the #2226 ledger recompute when PATCHed money fields change', async () => {
    harness.state.selectQueue = [[{ id: INVOICE_ID }]];
    harness.state.txUpdateRows = [{ id: INVOICE_ID, totalAmount: '100.00' }];
    harness.state.txSelectRows = [{ id: INVOICE_ID, totalAmount: '100.00', amountPaid: '0', balanceDue: '100.00', status: 'sent' }];

    const res = await invoicesRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/invoices/${INVOICE_ID}`, { totalAmount: 100 }),
      { params: Promise.resolve({ id: INVOICE_ID }) }
    );

    expect(res.status).toBe(200);
    expect(harness.paymentsStub.recalculateInvoicePayments).toHaveBeenCalledWith(
      expect.anything(),
      INVOICE_ID,
      TENANT
    );
  });
});

describe('GET /api/tenant/tasks/[id] — verb gap (#2289)', () => {
  const taskRow = (over: Record<string, unknown> = {}) => ({
    id: TASK_ID,
    tenantId: TENANT,
    title: 'Call customer',
    assignedTo: USER,
    createdBy: USER,
    deletedAt: null,
    ...over,
  });

  it('returns the row in the canonical { data } envelope for the owning user', async () => {
    harness.state.selectQueue = [[taskRow()]];

    const res = await tasksRoute.GET(
      request('GET', `http://localhost:3000/api/tenant/tasks/${TASK_ID}`),
      { params: Promise.resolve({ id: TASK_ID }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(TASK_ID);
    expect(json.error).toBeUndefined();
  });

  it('answers 404 for a row outside the caller tenant (tenant-scoped select finds nothing)', async () => {
    harness.state.selectQueue = [[]];

    const res = await tasksRoute.GET(
      request('GET', `http://localhost:3000/api/tenant/tasks/${TASK_ID}`),
      { params: Promise.resolve({ id: TASK_ID }) }
    );

    expect(res.status).toBe(404);
  });

  it('answers 404 (not 403) for a same-tenant task the caller neither owns nor created, without view_all', async () => {
    harness.state.selectQueue = [[taskRow({ assignedTo: 'other-1', createdBy: 'other-2' })]];
    harness.mockCan.mockReturnValue(false);

    const res = await tasksRoute.GET(
      request('GET', `http://localhost:3000/api/tenant/tasks/${TASK_ID}`),
      { params: Promise.resolve({ id: TASK_ID }) }
    );

    expect(res.status).toBe(404);
  });

  it('returns any live task once the caller holds tasks.view_all', async () => {
    harness.state.selectQueue = [[taskRow({ assignedTo: 'other-1', createdBy: 'other-2' })]];
    harness.mockCan.mockReturnValue(true);

    const res = await tasksRoute.GET(
      request('GET', `http://localhost:3000/api/tenant/tasks/${TASK_ID}`),
      { params: Promise.resolve({ id: TASK_ID }) }
    );

    expect(res.status).toBe(200);
  });

  it('short-circuits a malformed id to 404 without touching the database', async () => {
    const res = await tasksRoute.GET(
      request('GET', 'http://localhost:3000/api/tenant/tasks/not-a-uuid'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) }
    );

    expect(res.status).toBe(404);
    expect(harness.db.select).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tenant/invoices/[id]/payments/[paymentId] — verb gap (#2289)', () => {
  const totals = {
    totalAmount: 500,
    amountPaid: 250,
    balanceDue: 250,
    status: 'partially_paid',
    paidAt: null,
  };

  it('applies a partial correction and answers { data: { payment, invoice } }', async () => {
    harness.paymentsStub.updateInvoicePayment.mockResolvedValue({
      payment: { id: PAYMENT_ID, amount: '250.00' },
      invoice: totals,
      totals,
    });

    const res = await paymentsRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/invoices/${INVOICE_ID}/payments/${PAYMENT_ID}`, {
        amount: 250,
        payment_date: '2026-10-01',
      }),
      { params: Promise.resolve({ id: INVOICE_ID, paymentId: PAYMENT_ID }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.payment.id).toBe(PAYMENT_ID);
    expect(json.data.invoice.balanceDue).toBe(250);
    expect(harness.paymentsStub.updateInvoicePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: INVOICE_ID,
        paymentId: PAYMENT_ID,
        tenantId: TENANT,
        userId: USER,
        amount: 250,
        paymentDate: '2026-10-01',
        allowOverpayment: false,
      })
    );
    expect(harness.mockLogAudit).toHaveBeenCalledTimes(1);
  });

  it('rejects a body that carries no updatable field with 400', async () => {
    const res = await paymentsRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/invoices/${INVOICE_ID}/payments/${PAYMENT_ID}`, {}),
      { params: Promise.resolve({ id: INVOICE_ID, paymentId: PAYMENT_ID }) }
    );

    expect(res.status).toBe(400);
    expect(harness.paymentsStub.updateInvoicePayment).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount via the zod schema before touching the ledger', async () => {
    const res = await paymentsRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/invoices/${INVOICE_ID}/payments/${PAYMENT_ID}`, { amount: -5 }),
      { params: Promise.resolve({ id: INVOICE_ID, paymentId: PAYMENT_ID }) }
    );

    expect(res.status).toBe(400);
    expect(harness.paymentsStub.updateInvoicePayment).not.toHaveBeenCalled();
  });

  it('maps PaymentError(404) to a uniform { error } 404 without driver detail', async () => {
    harness.paymentsStub.updateInvoicePayment.mockRejectedValue(
      new harness.paymentsStub.PaymentError('Payment not found', 404)
    );

    const res = await paymentsRoute.PATCH(
      request('PATCH', `http://localhost:3000/api/tenant/invoices/${INVOICE_ID}/payments/${PAYMENT_ID}`, { notes: 'x' }),
      { params: Promise.resolve({ id: INVOICE_ID, paymentId: PAYMENT_ID }) }
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Payment not found');
    expect(JSON.stringify(json)).not.toMatch(/code|detail|constraint|stack/i);
  });
});
