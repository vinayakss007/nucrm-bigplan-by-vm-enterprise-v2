/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3337 — `PUT /api/tenant/subscriptions/[id]` checked the row existed under
 * `deletedAt IS NULL`, then wrote `status`/`autoRenew`/`cancelledAt` with
 * `WHERE id AND tenant_id` alone.
 *
 * Three separate dishonesties, all closed the way #3159/#3164/#3175/#3184/#3189
 * closed their own tables:
 *
 *  1. the write dropped the delete gate the read had just applied — a row
 *     soft-deleted (and cancelled, as `DELETE` does both) in the gap was still
 *     editable, resurrecting it with a live-looking status;
 *  2. the handler never even read the current `status` (`select({ id })` only),
 *     so there was no from-state to claim and a concurrent transition was
 *     silently stomped. The only guard was `concurrencyGuard`, opt-in by
 *     design: it returns null when the client omits `expectedUpdatedAt` — the
 *     default caller — and even then its read happens in its own statement;
 *  3. `logAudit` fired and a 200 `{data: undefined}` was returned even when the
 *     UPDATE matched zero rows.
 *
 * DB-free harness, the shape `contract-status-transition-race-3189.test.ts`
 * reuses: the UPDATE's WHERE is captured as SQL rendered through `PgDialect`
 * (a mock call count cannot show a missing predicate), `.returning()` is
 * replayed empty to show the handler honours a lost claim, and
 * `concurrencyGuard` is deliberately NOT mocked — its pass-through on a default
 * client is part of what is being proven.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB = '22222222-2222-2222-8222-222222222222';
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
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'subscriptions.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.readRows = [];
  state.updateReturns = [];
  state.updates = [];
  state.audits = [];
});

function subRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SUB, tenantId: TENANT, name: 'Managed hosting', planName: 'pro', status: 'active',
    amount: '1200.00', billingFrequency: 'monthly', autoRenew: true,
    startDate: '2026-01-01', currentPeriodEnd: '2026-11-01', cancelledAt: null,
    deletedAt: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'), updatedBy: USER,
    ...over,
  };
}

async function put(body: Record<string, unknown>) {
  const { PUT } = await import('@/app/api/tenant/subscriptions/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/subscriptions/${SUB}`, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PUT as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: SUB }) },
  );
}

/** The from-status a guarded write claims, read back out of the rendered SQL. */
function claimedStatus(c: Captured | undefined): string {
  expect(c, 'no UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status claim in: ${c!.sql}`).toMatch(/"service_subscriptions"\."status" = /i);
  return c!.sql + JSON.stringify(c!.params);
}

describe('a status write claims the status it read (#3337)', () => {
  it('the winning claim carries the exact read status, the tenant, the delete gate, and nothing interpolated', async () => {
    state.readRows = [subRow({ status: 'active' })];
    state.updateReturns = [[{ id: SUB }]];
    const res = await put({ status: 'cancelled', cancelledAt: '2026-10-28T00:00:00.000Z' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates).toHaveLength(1);
    const claim = claimedStatus(state.updates[0]);
    expect(claim).toContain('active');
    expect(claim, 'the WHERE claimed the target, not the from-status').not.toContain('cancelled');
    expect(state.updates[0].sql).toMatch(/"service_subscriptions"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"service_subscriptions"\."id"/);
    expect(state.updates[0].sql).toMatch(/"service_subscriptions"\."deleted_at" IS NULL/);
    // Bound as parameters, never spliced.
    expect(state.updates[0].params).toEqual([SUB, TENANT, 'active']);
    expect(state.updates[0].set).toMatchObject({ status: 'cancelled', updatedBy: USER });
    expect(state.audits.map(a => a.action)).toEqual(['subscription.updated']);
  });

  it('a subscription cancelled-and-deleted in the gap is not resurrected — 409, and no audit row', async () => {
    // The issue's own interleaving: A read `active`, DELETE committed
    // (`status:'cancelled'`, `deletedAt` set), and A's old unconditional UPDATE
    // stamped its status back over a dead row.
    state.readRows = [subRow({ status: 'active' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'active', autoRenew: true });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('concurrently');
    expect(JSON.parse(said).error).toContain('active');
    expect(state.audits, 'the lost claim was still audit-logged as an update').toEqual([]);
    expect(state.updates).toHaveLength(1);
    // Same-status payload claims too — `{status:'active'}` over a row the gap
    // cancelled is exactly as much of a resurrection as any other target.
    expect(claimedStatus(state.updates[0])).toContain('active');
  });

  it('the default client is covered: no expectedUpdatedAt, no opt-in, still claimed', async () => {
    // The whole point of #3337 — `concurrencyGuard` is REAL here, not stubbed,
    // and returns null for a body that never mentions it. Without the claim this
    // write would render no status predicate and win unconditionally.
    state.readRows = [subRow({ status: 'active' })];
    state.updateReturns = [[{ id: SUB }]];
    const res = await put({ status: 'past_due' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.stringify(state.updates[0].params)).not.toContain('expectedUpdatedAt');
    expect(claimedStatus(state.updates[0])).toContain('active');
  });

  it('a current status the code never writes is still claimed', async () => {
    // `status` is free text with no CHECK constraint; a legacy or hand-written
    // value must still be pinned, not blindly replaced.
    state.readRows = [subRow({ status: 'trialing' })];
    state.updateReturns = [[{ id: SUB }]];
    const res = await put({ status: 'active' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('trialing');
  });
});

describe('what #3337 does not change', () => {
  it('a field edit claims no status but still refuses to touch a deleted row', async () => {
    // A non-status write has no from-state to pin, so its claim is the delete
    // gate alone: a row soft-deleted in the gap answers 404, not a fake 200.
    state.readRows = [subRow({ status: 'cancelled' })];
    state.updateReturns = [[]];
    const res = await put({ name: 'Managed hosting — relabel' });
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql, 'a field edit started claiming status').not.toMatch(/"service_subscriptions"\."status"/);
    expect(state.updates[0].sql).toMatch(/"service_subscriptions"\."deleted_at" IS NULL/);
    expect(state.audits, 'a lost write was audit-logged').toEqual([]);
  });

  it('a won field edit still lands and audits', async () => {
    state.readRows = [subRow()];
    state.updateReturns = [[{ id: SUB }]];
    const res = await put({ amount: '99.50' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates[0].set).toMatchObject({ amount: 99.5 });
    expect(state.audits).toHaveLength(1);
  });

  it('an opted-in client whose updatedAt moved is still refused before any write', async () => {
    state.readRows = [subRow({ status: 'active', updatedAt: new Date('2026-10-05T00:00:00.000Z') })];
    const res = await put({ status: 'cancelled', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('Stale data');
    expect(state.updates, 'the guarded write ran anyway').toEqual([]);
  });

  it('an opted-in client that is current still gets its edit through', async () => {
    state.readRows = [subRow({ status: 'active', updatedAt: new Date('2026-10-01T00:00:00.000Z') })];
    state.updateReturns = [[{ id: SUB }]];
    const res = await put({ status: 'cancelled', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    expect(res.status, await res.text()).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('active');
  });

  it('a subscription the caller cannot see answers 404 before any write', async () => {
    state.readRows = [];
    const res = await put({ status: 'cancelled' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
    expect(state.audits).toEqual([]);
  });

  it('a payload with no mutable field is refused without touching the row', async () => {
    const res = await put({ nonsense: 'x' });
    expect(res.status, await res.text()).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('a non-numeric amount is refused by the existing check, not the claim', async () => {
    state.readRows = [subRow()];
    const res = await put({ amount: 'abc' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('the claim is this caller’s tenant and row only', async () => {
    state.readRows = [subRow()];
    state.updateReturns = [[{ id: SUB }]];
    const res = await put({ status: 'cancelled' });
    expect(res.status, await res.text()).toBe(200);
    expect(state.updates[0].params).toEqual([SUB, TENANT, 'active']);
  });
});
