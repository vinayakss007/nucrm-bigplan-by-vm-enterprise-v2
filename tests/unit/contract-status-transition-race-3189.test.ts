/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3189 — `PUT /api/tenant/contracts/[id]` read a contract, vetted the requested
 * status transition against that unlocked read, and wrote with
 * `WHERE id AND tenant_id` alone.
 *
 * Its only concurrency check was `concurrencyGuard`, and that is opt-in by
 * design: `lib/api/concurrency.ts:103` returns null when the client sent no
 * `expectedUpdatedAt`, so the default client — any caller that does not know the
 * column exists — got no protection at all. Even a well-behaved caller did not:
 * the guard reads `updatedAt` in its own statement, separately from the write, so
 * the check-then-write window stays open for the whole duration of the vet.
 *
 * The consequence is the same one #3159/#3164/#3175/#3184 each closed on their own
 * table, and the issue names the worst interleaving:
 *
 *   A reads `active`, PUTs `suspended`. B terminates it (`active → terminated`)
 *   and commits in between. A's unconditional UPDATE then stamps `suspended` over
 *   a TERMINAL status — a cancelled contract is alive again, and nothing records
 *   that the terminate was lost.
 *
 * Postgres gives the fix away for free: the UPDATE's WHERE is re-evaluated under
 * the row lock, so naming the from-status costs one predicate and turns that
 * interleaving into zero rows affected — which is the race itself, and the only
 * thing a handler can honestly answer 409 from.
 *
 * DB-free harness, the shape `offer-transition-guarded-write-3159.test.ts`
 * establishes and `order-status-transition-race-3184.test.ts` reuses: the UPDATE's
 * WHERE is captured as SQL rendered through `PgDialect` (a mock call count cannot
 * show a missing predicate), and `.returning()` is replayed empty to show the
 * handler honours a lost claim instead of reporting success. `concurrencyGuard` is
 * deliberately NOT mocked — its pass-through on a default client is part of what
 * is being proven, and so is the fact that the non-status path still answers to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACT = '44444444-4444-4444-8444-444444444444';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** Rows every pre-lock SELECT in the handler resolves to (the existence read,
   *  and `concurrencyGuard`'s `updatedAt` read when the client opted in). */
  readRows: [] as unknown[],
  /** `.returning()` rows for each UPDATE, in call order. */
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  audits: [] as Record<string, unknown>[],
};

const db: Record<string, unknown> = {
  update: () => {
    // `.set()` runs before `.where()`; the statement is pushed only when the
    // handler consumes it, so `state.updates` is exactly the writes that landed.
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
  },
  select: () => {
    const builder: Record<string, unknown> = {};
    builder['from'] = () => builder;
    builder['where'] = () => builder;
    builder['limit'] = () => Promise.resolve(state.readRows);
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

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'contracts.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.readRows = [];
  state.updateReturns = [];
  state.updates = [];
  state.audits = [];
});

function contractRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CONTRACT, tenantId: TENANT, title: 'Managed hosting', status: 'active',
    contractType: 'retainer', totalValue: '1200.00', terms: null, notes: null,
    billingFrequency: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31',
    deletedAt: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'), updatedBy: USER,
    ...over,
  };
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/tenant/contracts/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/contracts/${CONTRACT}`, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PUT as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: CONTRACT }) },
  );
}

/** The from-status a guarded write claims, read back out of the rendered SQL. */
function claimedStatus(c: Captured | undefined): string {
  expect(c, 'no UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status claim in: ${c!.sql}`).toMatch(/"contracts"\."status" = /i);
  return c!.sql + JSON.stringify(c!.params);
}

describe('a status write claims the status it vetted against (#3189)', () => {
  it('the winning claim carries the exact read status, the tenant, and nothing interpolated', async () => {
    state.readRows = [contractRow({ status: 'active' })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ status: 'suspended' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates).toHaveLength(1);
    const claim = claimedStatus(state.updates[0]);
    expect(claim).toContain('active');
    expect(claim, 'the WHERE claimed the target, not the from-status').not.toContain('suspended');
    expect(state.updates[0].sql).toMatch(/"contracts"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"contracts"\."id"/);
    // Bound as parameters, never spliced: `updateReturns` replays a win, so this
    // also pins that the claim cannot be steered by a status string from the body.
    expect(state.updates[0].params).toEqual([CONTRACT, TENANT, 'active']);
    expect(state.updates[0].set).toMatchObject({ status: 'suspended', updatedBy: USER });
    expect(state.audits.map(a => a.action)).toEqual(['contract.updated']);
  });

  it('a contract terminated in the gap is not resurrected — 409, and no audit row', async () => {
    // The issue's own interleaving: A read `active`, B committed `terminated`,
    // and A's old unconditional UPDATE wrote `suspended` over a terminal status.
    state.readRows = [contractRow({ status: 'active' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'suspended' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('concurrently');
    expect(JSON.parse(said).error).toContain('active');
    expect(state.audits, 'the lost claim was still audit-logged as an update').toEqual([]);
    expect(state.updates).toHaveLength(1);
  });

  it('the default client is covered: no expectedUpdatedAt, no opt-in, still claimed', async () => {
    // This is the whole point of #3189 — `concurrencyGuard` is REAL here, not
    // stubbed, and it returns null for a body that never mentions it. Without the
    // claim this write would render `WHERE id AND tenant_id` and win unconditionally.
    state.readRows = [contractRow({ status: 'active' })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ status: 'terminated' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.stringify(state.updates[0].params)).not.toContain('expectedUpdatedAt');
    expect(claimedStatus(state.updates[0])).toContain('active');
  });

  it('a same-status payload claims too — a no-op status write cannot stomp either', async () => {
    // `{status:'active'}` against a row the vet finds unchanged skips the
    // transition check entirely, so before this it wrote unconditionally. A row
    // terminated in the gap would come back to life from a request that never
    // asked for a transition at all.
    state.readRows = [contractRow({ status: 'active' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'active', notes: 'renewed verbally' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(claimedStatus(state.updates[0])).toContain('active');
    expect(state.audits).toEqual([]);
  });

  it('a current status the table has no key for is still claimed, and still refused by nothing', async () => {
    // `contracts` has no undefined-lookup defect to fix (#3184's `draft` bug), but
    // a legacy or hand-written status value is `allowed === undefined`, which the
    // vet waves through. The claim must not depend on the vet having a key.
    state.readRows = [contractRow({ status: 'archived' })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ status: 'active' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('archived');
  });
});

describe('what #3189 does not change', () => {
  it('a transition the JS vet refuses never reaches the write', async () => {
    state.readRows = [contractRow({ status: 'terminated' })];
    const res = await put({ status: 'active' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(JSON.parse(said).error).toContain('terminated');
    expect(state.updates, 'the refused write still landed').toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a draft that is not allowed to reach expired is refused with 400', async () => {
    state.readRows = [contractRow({ status: 'draft' })];
    const res = await put({ status: 'expired' });
    expect(res.status, await res.text()).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('a field edit claims no status — that path stays concurrencyGuard’s', async () => {
    state.readRows = [contractRow({ status: 'terminated' })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ title: 'Managed hosting — legacy' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql, 'a field edit started claiming status').not.toMatch(/"contracts"\."status"/);
    expect(state.updates[0].set).toMatchObject({ title: 'Managed hosting — legacy' });
    expect(state.audits).toHaveLength(1);
  });

  it('an opted-in client whose updatedAt moved is still refused before any write', async () => {
    // The opt-in guard keeps its job and its ordering: it answers on the row the
    // handler read, and the claim below never gets a chance to run.
    state.readRows = [contractRow({ status: 'active', updatedAt: new Date('2026-10-05T00:00:00.000Z') })];
    const res = await put({ status: 'suspended', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('Stale data');
    expect(state.updates, 'the guarded write ran anyway').toEqual([]);
  });

  it('an opted-in client that is current still gets its edit through', async () => {
    state.readRows = [contractRow({ status: 'active', updatedAt: new Date('2026-10-01T00:00:00.000Z') })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ status: 'suspended', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    expect(res.status, await res.text()).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('active');
  });

  it('a contract the caller cannot see answers 404 before any write', async () => {
    state.readRows = [];
    const res = await put({ status: 'terminated' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a payload with no mutable field is refused without touching the row', async () => {
    const res = await put({ nonsense: 'x' });
    expect(res.status, await res.text()).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('a negative contract value is refused by the #2256 check, not the claim', async () => {
    state.readRows = [contractRow()];
    const res = await put({ totalValue: '-5' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('the claim is this caller’s tenant and row only', async () => {
    // The read is tenant-scoped, and so is the write: a row that exists under
    // another workspace is never what the claim resolves against.
    state.readRows = [contractRow({ tenantId: OTHER_TENANT })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ status: 'suspended' });
    expect(res.status, await res.text()).toBe(200);
    expect(state.updates[0].params).toEqual([CONTRACT, TENANT, 'active']);
  });
});
