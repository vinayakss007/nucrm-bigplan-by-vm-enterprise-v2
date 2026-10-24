/**
 * #3189 — the contracts PUT is the orders twin (#3184): it vets a status
 * transition against an unlocked read, then wrote `WHERE id AND tenant_id`
 * alone.
 *
 * The only concurrency check on the route — `concurrencyGuard` — is opt-in
 * (absent `expectedUpdatedAt` returns null, and even when sent its guard READ
 * is a separate statement from the write), so the default client had a full
 * check-then-write window: an in-flight `active → suspended` PUT stamped over
 * a concurrently terminated contract resurrected a terminal state.
 *
 * The fix claims the vetted from-status inside the UPDATE's WHERE and reads
 * the write back; zero rows is the race itself → 409, no audit, nothing else
 * lands. A no-op status write (target === current) is claimed too: it asserts
 * "the row was still where I read it" and stays out of the audit log when the
 * answer is no.
 *
 * DB-free harness, same as offer-transition-guarded-write-3159 / the #3184
 * suite: rendered WHERE via PgDialect proves the guard; an empty
 * `.returning()` replays the lost claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '44444444-4444-4444-8444-444444444444';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTRACT = '55555555-5555-4555-8555-555555555555';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  contractRows: [] as unknown[],
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  audits: [] as Record<string, unknown>[],
};

const db: Record<string, unknown> = {
  update: () => {
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
    builder['limit'] = () => Promise.resolve(state.contractRows);
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
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
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
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'contracts.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.contractRows = [];
  state.updateReturns = [];
  state.updates = [];
  state.audits = [];
});

function contractRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: CONTRACT, tenantId: TENANT, status: 'active', title: 'Annual services', ...over };
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

function claimedStatus(c: Captured | undefined): string {
  expect(c, 'no UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status claim in: ${c!.sql}`).toMatch(/"contracts"\."status"/i);
  return c!.sql + JSON.stringify(c!.params);
}

describe('a status change claims the vetted from-status (#3189)', () => {
  it('the winning write carries the exact status that was read and the tenant', async () => {
    state.contractRows = [contractRow({ status: 'active' })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ status: 'suspended' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('active');
    expect(state.updates[0].sql).toMatch(/"contracts"\."tenant_id"/);
    expect(state.updates[0].set).toMatchObject({ status: 'suspended' });
    expect(state.audits).toHaveLength(1);
  });

  it('a stale write answers 409 and lands no audit — a terminated contract stays terminated', async () => {
    // The read saw `active`; a concurrent terminate committed `terminated` in
    // the gap. Before #3189 the unconditional UPDATE resurrected it.
    state.contractRows = [contractRow({ status: 'active' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'suspended' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('concurrently');
    expect(state.audits, 'the lost claim was still audit-logged as an update').toEqual([]);
  });

  it('a transition the vet refuses never reaches the write, unchanged', async () => {
    state.contractRows = [contractRow({ status: 'terminated' })];
    const res = await put({ status: 'active' });
    const said = await res.text();
    expect(res.status, said).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it('a no-op status write is claimed too, and stays out of the audit when the row moved', async () => {
    state.contractRows = [contractRow({ status: 'active' })];
    state.updateReturns = [[]];
    const res = await put({ status: 'active' });
    expect(res.status, await res.text()).toBe(409);
    expect(claimedStatus(state.updates[0])).toContain('active');
    expect(state.audits).toEqual([]);
  });
});

describe('the non-status path keeps its own shape (#3189 acceptance)', () => {
  it('a field edit claims no status — the guard for that path is concurrencyGuard', async () => {
    state.contractRows = [contractRow({ status: 'terminated' })];
    state.updateReturns = [[{ id: CONTRACT }]];
    const res = await put({ title: 'Renamed' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates[0].sql, 'a field edit started claiming status').not.toMatch(/"contracts"\."status"/);
    expect(state.updates[0].set).toMatchObject({ title: 'Renamed' });
    expect(state.audits).toHaveLength(1);
  });

  it('a missing contract still 404s before any write', async () => {
    state.contractRows = [];
    const res = await put({ status: 'suspended' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
  });
});
