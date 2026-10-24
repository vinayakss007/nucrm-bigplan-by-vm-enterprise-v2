/**
 * #3184 — the orders PUT vets a status transition against an unlocked read and
 * used to write with `WHERE id AND tenant_id` alone.
 *
 * The status branch never ran `concurrencyGuard` (only the non-status branch
 * did), so two tabs moving the same order both passed their JS checks and the
 * last commit silently won the column — including terminal `delivered`/
 * `cancelled` being resurrected by an in-flight write that had read an earlier
 * status. The fix claims the vetted status in the UPDATE's WHERE and reads the
 * write back; zero rows is the race itself → 409, no audit, nothing else lands.
 *
 * Second defect pinned here: `orders.status` defaults to `'draft'`, which was
 * not a key in VALID_TRANSITIONS, so the lookup was `undefined` and the vet was
 * skipped entirely — any target (even `delivered`) was admitted from a
 * never-touched order. `draft` is now a real key mirroring `pending`.
 *
 * DB-free harness, same as offer-transition-guarded-write-3159: the rendered
 * WHERE (via PgDialect) proves the guard exists; the empty `.returning()`
 * replay proves the handler honors a lost claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** rows both existence/status SELECTs resolve to (the pre-lock read). */
  orderRows: [] as unknown[],
  /** `.returning()` rows for the UPDATE. */
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  audits: [] as Record<string, unknown>[],
};

const db: Record<string, unknown> = {
  update: () => {
    // `.set()` runs before `.where()`; the statement is only pushed when the
    // handler consumes it (`.returning()` or a bare await).
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
        commit();
        return Promise.resolve(state.updateReturns[0] ?? []);
      },
    };
    return node;
  },
  select: () => {
    const builder: Record<string, unknown> = {};
    builder['from'] = () => builder;
    builder['where'] = () => builder;
    builder['limit'] = () => Promise.resolve(state.orderRows);
    return builder;
  },
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx), requirePerm: vi.fn(() => null) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  // surface real errors in tests instead of a 500 envelope
  apiError: vi.fn((err: unknown) => { throw err; }),
}));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'orders.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.orderRows = [];
  state.updateReturns = [];
  state.updates = [];
  state.audits = [];
});

function orderRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: ORDER, tenantId: TENANT, status: 'processing', title: 'Widget restock', ...over };
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/tenant/orders/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/orders/${ORDER}`, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PUT as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: ORDER }) },
  );
}

/** The claim a guarded write carries, read back out of the rendered SQL. */
function claimedStatus(c: Captured | undefined): string {
  expect(c, 'no UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status claim in: ${c!.sql}`).toMatch(/"orders"\."status"/i);
  return c!.sql + JSON.stringify(c!.params);
}

describe('a status change claims the vetted from-status (#3184)', () => {
  it('the winning write carries the exact status that was read, and stamps the transition', async () => {
    state.orderRows = [orderRow({ status: 'processing' })];
    state.updateReturns = [[{ id: ORDER }]];
    const res = await put({ status: 'shipped', trackingNumber: 'TRK-1' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('processing');
    expect(state.updates[0].sql).toMatch(/"orders"\."tenant_id"/);
    expect(state.updates[0].set).toMatchObject({ status: 'shipped' });
    expect(state.updates[0].set.shippedAt).toBeInstanceOf(Date);
    expect(state.audits).toHaveLength(1);
  });

  it('a stale write answers 409 and lands nothing — no audit, no stomped terminal state', async () => {
    // The read saw `processing`; a concurrent cancel committed `cancelled` in
    // the gap. Before #3184 the unconditional UPDATE resurrected the order.
    state.orderRows = [orderRow({ status: 'processing' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'shipped' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('concurrently');
    expect(state.audits, 'the lost claim was still audit-logged as an update').toEqual([]);
  });

  it('a transition the vet refuses never reaches the write, unchanged', async () => {
    state.orderRows = [orderRow({ status: 'delivered' })];
    const res = await put({ status: 'processing' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(state.updates).toEqual([]);
  });
});

describe('draft is a vetted key (#3184, the undefined-lookup half)', () => {
  it('draft → delivered is refused, not waved through by an undefined lookup', async () => {
    state.orderRows = [orderRow({ status: 'draft' })];
    const res = await put({ status: 'delivered' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(JSON.parse(said).error).toContain('draft');
    expect(state.updates, 'the refused write still landed').toEqual([]);
  });

  it('draft → cancelled is admitted and claimed on draft', async () => {
    state.orderRows = [orderRow({ status: 'draft' })];
    state.updateReturns = [[{ id: ORDER }]];
    const res = await put({ status: 'cancelled' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('draft');
    expect(state.updates[0].set.cancelledAt).toBeInstanceOf(Date);
  });

  it('draft → processing is admitted (mirrors pending)', async () => {
    state.orderRows = [orderRow({ status: 'draft' })];
    state.updateReturns = [[{ id: ORDER }]];
    const res = await put({ status: 'processing' });
    expect(res.status, await res.text()).toBe(200);
  });
});

describe('the non-status path keeps its own shape (#3184 acceptance)', () => {
  it('a field edit claims no status — the guard for that path is concurrencyGuard', async () => {
    state.orderRows = [orderRow({ status: 'delivered' })];
    state.updateReturns = [[{ id: ORDER }]];
    const res = await put({ title: 'Renamed' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates[0].sql, 'a field edit started claiming status').not.toMatch(/"orders"\."status"/);
    expect(state.updates[0].set).toMatchObject({ title: 'Renamed' });
    expect(state.audits).toHaveLength(1);
  });

  it('a missing order still 404s before any write', async () => {
    state.orderRows = [];
    const res = await put({ status: 'shipped' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
  });
});
