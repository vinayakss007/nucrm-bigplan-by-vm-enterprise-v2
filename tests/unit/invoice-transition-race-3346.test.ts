/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3346 — `PUT/PATCH /api/tenant/invoices/[id]` read the row under
 * `id AND tenant_id AND deleted_at IS NULL`, vetted the status vocabulary
 * (#2258) and the ledger-owned refusal (#2226) in JS, then wrote with
 * `WHERE id AND tenant_id` alone — on both the plain path and inside the
 * #2226 ledger transaction, where `recalculateInvoicePayments()` ran
 * unconditionally after the UPDATE whether or not it matched.
 *
 * So a DELETE landing in the gap (which tombstones *and* forces
 * `status:'cancelled'`) left the UPDATE writing over a dead row — and, on the
 * ledger path, recomputed the payment summary for an invoice that no longer
 * exists in the live set. A competing status write in the gap was stomped
 * with no claim of the vetted from-state. `logAudit('invoice.updated')` fired
 * and a 200 was returned even on zero rows.
 *
 * Fix, per the #3159/#3164/#3175/#3184/#3189/#3337/#3340 family: the read
 * carries `status`; both write paths re-assert `deletedAt IS NULL` and pin the
 * exact read status whenever the payload writes status; a missed claim inside
 * the ledger tx returns null and skips `recalculateInvoicePayments` entirely;
 * zero rows + claim → 409, zero rows without claim → 404; the audit row only
 * lands on a won write.
 *
 * DB-free harness: the UPDATE's WHERE is rendered through `PgDialect` (a mock
 * call count cannot show a missing predicate), `.returning()` replays empty to
 * show a lost claim is honoured, and `concurrencyGuard` is deliberately NOT
 * mocked — its pass-through for a default client is part of what is proven.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVOICE = '22222222-2222-2222-8222-222222222222';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** Rows every pre-lock db SELECT resolves to (the existence read, and
   *  `concurrencyGuard`'s read when the client opts in). */
  readRows: [] as unknown[],
  /** Rows the ledger transaction's post-recalc re-read resolves to. */
  txRows: [] as unknown[],
  /** `.returning()` rows per UPDATE, in commit order (plain and tx share it). */
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  audits: [] as Record<string, unknown>[],
  /** How many times recalculateInvoicePayments() ran. */
  recalcs: 0,
};

function makeUpdateNode(): Record<string, unknown> {
  // `.set()` runs before `.where()`; the statement is pushed when `.returning()`
  // consumes it, so `state.updates` is exactly the writes that landed.
  let rec: Captured = { sql: '', params: [], set: {} };
  const commit = (): void => { state.updates.push(rec); };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    where: (pred: unknown) => {
      const rendered = dialect.sqlToQuery(pred as never);
      rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
      return node;
    },
    returning: () => {
      const at = state.updates.length;
      commit();
      return Promise.resolve(state.updateReturns[at] ?? []);
    },
  };
  return node;
}

function makeSelectNode(rows: () => unknown[]) {
  const builder: Record<string, unknown> = {};
  builder['from'] = () => builder;
  builder['where'] = () => builder;
  builder['limit'] = () => Promise.resolve(rows());
  return builder;
}

const db: Record<string, unknown> = {
  update: makeUpdateNode,
  select: () => makeSelectNode(() => state.readRows),
  transaction: async (fn: (tx: Record<string, unknown>) => unknown) =>
    fn({
      update: makeUpdateNode,
      select: () => makeSelectNode(() => state.txRows),
    }),
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => ctx),
    requirePerm: vi.fn(() => null),
    // cookie/header CSRF is exercised elsewhere; here it must not mask the race
    requireCsrf: vi.fn(() => null),
  };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  // surface real errors in tests rather than a 500 envelope
  apiError: vi.fn((err: unknown) => { throw err; }),
}));
vi.mock('@/lib/billing/payments', () => ({
  recalculateInvoicePayments: vi.fn(async () => { state.recalcs += 1; }),
}));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'invoices.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.readRows = [];
  state.txRows = [];
  state.updateReturns = [];
  state.updates = [];
  state.audits = [];
  state.recalcs = 0;
});

function invoiceRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INVOICE, tenantId: TENANT, title: 'Hosting — October', status: 'draft',
    subtotal: '1000.00', discountAmount: '0.00', taxAmount: '0.00', totalAmount: '1000.00',
    amountPaid: '0.00', balanceDue: '1000.00', taxRate: '0.00',
    deletedAt: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  };
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/tenant/invoices/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/invoices/${INVOICE}`, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PUT as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: INVOICE }) },
  );
}

/** The from-status a guarded write claims, read back out of the rendered WHERE. */
function claimedStatus(c: Captured | undefined): string {
  expect(c, 'no UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status claim in: ${c!.sql}`).toMatch(/"invoices"\."status" = /i);
  return c!.sql + JSON.stringify(c!.params);
}

describe('an invoice status write claims the status it read (#3346)', () => {
  it('the winning claim carries the exact read status, the tenant, the delete gate, and nothing interpolated', async () => {
    state.readRows = [invoiceRow({ status: 'draft' })];
    state.updateReturns = [[invoiceRow({ status: 'sent' })]];
    const res = await put({ status: 'sent' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates).toHaveLength(1);
    const claim = claimedStatus(state.updates[0]);
    expect(claim).toContain('draft');
    expect(claim, 'the WHERE claimed the target, not the from-status').not.toContain('sent');
    expect(state.updates[0].sql).toMatch(/"invoices"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"invoices"\."id"/);
    expect(state.updates[0].sql).toMatch(/"invoices"\."deleted_at" IS NULL/i);
    expect(state.updates[0].params).toEqual([INVOICE, TENANT, 'draft']);
    expect(state.updates[0].set).toMatchObject({ status: 'sent', updatedBy: USER });
    expect(state.audits.map(a => a.action)).toEqual(['invoice.updated']);
  });

  it('an invoice DELETEd in the gap is not written over — 409, no audit', async () => {
    // The interleaving from the issue: A reads `draft`, DELETE commits
    // (`deletedAt` + `status:'cancelled'`), A's claim matches zero rows.
    state.readRows = [invoiceRow({ status: 'draft' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'sent' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('concurrently');
    expect(JSON.parse(said).error).toContain('draft');
    expect(state.audits, 'the lost claim was still audit-logged as an update').toEqual([]);
    expect(state.updates).toHaveLength(1);
  });

  it('a competing status write in the gap is refused, not stomped', async () => {
    state.readRows = [invoiceRow({ status: 'draft' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'cancelled' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(claimedStatus(state.updates[0])).toContain('draft');
  });

  it('the default client is covered: no expectedUpdatedAt, no opt-in, still claimed', async () => {
    // `concurrencyGuard` is REAL here, not stubbed, and returns null for a body
    // that never mentions it. Without the claim this write would render no
    // status predicate and win unconditionally.
    state.readRows = [invoiceRow({ status: 'overdue' })];
    state.updateReturns = [[invoiceRow({ status: 'sent' })]];
    const res = await put({ status: 'sent' });
    expect(res.status, await res.text()).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('overdue');
  });

  it('a same-status payload claims too — it is exactly as much a resurrection as any other target', async () => {
    state.readRows = [invoiceRow({ status: 'sent' })];
    state.updateReturns = [[invoiceRow()]];
    const res = await put({ status: 'sent' });
    expect(res.status, await res.text()).toBe(200);
    expect(claimedStatus(state.updates[0])).toMatch(/"invoices"\."status"/);
    expect(state.updates[0].params).toContain('sent');
  });
});

describe('the #2226 ledger path claims before it recomputes (#3346)', () => {
  it('a missed claim inside the tx skips recalculateInvoicePayments entirely', async () => {
    // Money edit + status write: the UPDATE matches zero rows (tombstoned in
    // the gap) and the balance recalc must NOT run for a row we never wrote.
    state.readRows = [invoiceRow({ status: 'draft' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'sent', totalAmount: '1500.00' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(state.recalcs, 'the ledger recalc ran after a lost claim').toBe(0);
    expect(state.audits).toEqual([]);
    // the tx write claims just like the plain path
    expect(claimedStatus(state.updates[0])).toContain('draft');
    expect(state.updates[0].sql).toMatch(/"invoices"\."deleted_at" IS NULL/i);
  });

  it('a won ledger write recalcs exactly once, re-reads, and audits', async () => {
    state.readRows = [invoiceRow({ status: 'draft' })];
    state.updateReturns = [[invoiceRow({ status: 'draft', totalAmount: '1500.00' })]];
    state.txRows = [invoiceRow({ totalAmount: '1500.00', balanceDue: '1500.00' })];
    const res = await put({ totalAmount: '1500.00' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.recalcs).toBe(1);
    expect(JSON.parse(said).data.balanceDue).toBe('1500.00');
    expect(state.audits.map(a => a.action)).toEqual(['invoice.updated']);
    // a money edit that does not write status claims no from-status...
    expect(state.updates[0].sql).not.toMatch(/"invoices"\."status"/i);
    // ...but still refuses to touch a tombstoned row
    expect(state.updates[0].sql).toMatch(/"invoices"\."deleted_at" IS NULL/i);
  });

  it('a won plain (non-ledger) money edit still writes and audits', async () => {
    state.readRows = [invoiceRow()];
    state.updateReturns = [[invoiceRow({ notes: 'net-30' })]];
    const res = await put({ notes: 'net-30' });
    expect(res.status, await res.text()).toBe(200);
    expect(state.recalcs, 'notes are not a ledger-affecting field').toBe(0);
    expect(state.audits).toHaveLength(1);
  });

  it('a field edit over a row deleted in the gap answers 404, not a fake 200', async () => {
    state.readRows = [invoiceRow()];
    state.updateReturns = [[]];
    const res = await put({ notes: 'too late' });
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(state.audits, 'a lost write was audit-logged').toEqual([]);
    expect(state.updates[0].sql).toMatch(/"invoices"\."deleted_at" IS NULL/i);
  });
});

describe('what #3346 does not change', () => {
  it('an invoice the caller cannot see answers 404 before any write', async () => {
    state.readRows = [];
    const res = await put({ status: 'sent' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a ledger-owned status is still refused before the read (#2226)', async () => {
    const res = await put({ status: 'paid' });
    const said = await res.text();
    expect(res.status, said).toBe(422);
    expect(state.updates).toEqual([]);
  });

  it('an out-of-vocabulary status is still refused up front (#2258)', async () => {
    const res = await put({ status: 'refunded' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('hand-setting the derived summary is still refused (#2226)', async () => {
    const res = await put({ amountPaid: '999.00' });
    expect(res.status, await res.text()).toBe(422);
    expect(state.updates).toEqual([]);
  });

  it('a negative money field is still refused (#2256)', async () => {
    state.readRows = [invoiceRow()];
    const res = await put({ taxRate: '-5' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('an opted-in client whose updatedAt moved is refused before any write', async () => {
    state.readRows = [invoiceRow({ updatedAt: new Date('2026-10-05T00:00:00.000Z') })];
    const res = await put({ status: 'sent', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(state.updates, 'the guarded write ran anyway').toEqual([]);
  });

  it('the claim is this caller’s tenant and row only', async () => {
    state.readRows = [invoiceRow({ status: 'pending' })];
    state.updateReturns = [[invoiceRow()]];
    const res = await put({ status: 'sent' });
    expect(res.status, await res.text()).toBe(200);
    expect(state.updates[0].params).toEqual([INVOICE, TENANT, 'pending']);
  });
});
