/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3340 — `PATCH /api/tenant/lead-warming/campaigns/[id]` read nothing before
 * it wrote: `status` was freely mutable, the WHERE was `id AND tenant_id`
 * alone, and the only check was the opt-in `concurrencyGuard`.
 *
 * The blast radius the issue names: this route's own `DELETE` sets
 * `status:'archived'` AND `deletedAt`, while
 * `lib/lead-warming/engine.ts:198/:469` selects sending candidates by
 * `status='active'` with no tombstone filter — so an in-flight PATCH that
 * stamped `active` over a committed delete hands a deleted campaign back to
 * the engine, and it keeps messaging contacts.
 *
 * DB-free harness, the shape `contract-status-transition-race-3189.test.ts`
 * and `service-subscription-transition-race-3337.test.ts` reuse: the UPDATE's
 * WHERE is captured as SQL rendered through `PgDialect` (a mock call count
 * cannot show a missing predicate), `.returning()` is replayed empty to show
 * the handler honours a lost claim, and `concurrencyGuard` is deliberately NOT
 * mocked — its pass-through on a default client is part of what is proven.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN = '11111111-1111-1111-8111-111111111111';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** Rows every pre-lock SELECT resolves to (the from-state read, and
   *  `concurrencyGuard`'s `updatedAt` read when the client opted in). */
  readRows: [] as unknown[],
  /** `.returning()` rows for each UPDATE, in call order. */
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
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
  return { ...actual, requireAuth: vi.fn(async () => ctx), can: vi.fn(() => true) };
});
vi.mock('@/lib/ai/plan-gate', () => ({ requireAiFeature: vi.fn(async () => null) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((err: unknown) => { throw err; }),
}));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: {},
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.readRows = [];
  state.updateReturns = [];
  state.updates = [];
});

function campaignRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAMPAIGN, tenantId: TENANT, name: 'Birthday warming', status: 'active',
    deletedAt: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...over,
  };
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/tenant/lead-warming/campaigns/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/lead-warming/campaigns/${CAMPAIGN}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: CAMPAIGN }) },
  );
}

/** The from-status a guarded write claims, read back out of the rendered SQL. */
function claimedStatus(c: Captured | undefined): string {
  expect(c, 'no UPDATE ran').toBeTruthy();
  expect(c!.sql, `no status claim in: ${c!.sql}`).toMatch(/"lead_warming_campaigns"\."status" = /i);
  return c!.sql + JSON.stringify(c!.params);
}

describe('a status write claims the status it read (#3340)', () => {
  it('the winning claim carries the exact read status, the tenant, the tombstone gate, and nothing interpolated', async () => {
    state.readRows = [campaignRow({ status: 'active' })];
    state.updateReturns = [[{ id: CAMPAIGN }]];
    const res = await patch({ status: 'paused' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates).toHaveLength(1);
    const claim = claimedStatus(state.updates[0]);
    expect(claim).toContain('active');
    expect(claim, 'the WHERE claimed the target, not the from-status').not.toContain('paused');
    expect(state.updates[0].sql).toMatch(/"lead_warming_campaigns"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"lead_warming_campaigns"\."deleted_at" IS NULL/);
    expect(state.updates[0].params).toEqual([CAMPAIGN, TENANT, 'active']);
    expect(state.updates[0].set).toMatchObject({ status: 'paused' });
  });

  it('a campaign archived-and-deleted by DELETE in the gap is not resurrected — 409', async () => {
    // The issue's own interleaving: the engine would take a stomped-back
    // `active` as a live campaign and keep messaging contacts.
    state.readRows = [campaignRow({ status: 'active' })];
    state.updateReturns = [[]];
    const res = await patch({ status: 'active' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('concurrently');
    expect(JSON.parse(said).error).toContain('active');
    expect(state.updates).toHaveLength(1);
    // A same-status payload claims too — writing `active` over a row the gap
    // archived/deleted is exactly as much of a resurrection as any other target.
    expect(claimedStatus(state.updates[0])).toContain('active');
  });

  it('the default client is covered: no expectedUpdatedAt, no opt-in, still claimed', async () => {
    state.readRows = [campaignRow({ status: 'active' })];
    state.updateReturns = [[{ id: CAMPAIGN }]];
    const res = await patch({ status: 'archived' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.stringify(state.updates[0].params)).not.toContain('expectedUpdatedAt');
    expect(claimedStatus(state.updates[0])).toContain('active');
  });

  it('a status the declared vocabulary never lists is still claimed', async () => {
    // The schema comment names active|paused|draft|archived but the column is
    // free text; a legacy value must be pinned, not blindly replaced.
    state.readRows = [campaignRow({ status: 'queued' })];
    state.updateReturns = [[{ id: CAMPAIGN }]];
    const res = await patch({ status: 'active' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(claimedStatus(state.updates[0])).toContain('queued');
  });
});

describe('what #3340 does not change', () => {
  it('a field edit claims no status but still refuses to touch a deleted row', async () => {
    state.readRows = [campaignRow({ status: 'archived' })];
    state.updateReturns = [[]];
    const res = await patch({ name: 'Renamed warming' });
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql, 'a field edit started claiming status').not.toMatch(/"lead_warming_campaigns"\."status"/);
    expect(state.updates[0].sql).toMatch(/"lead_warming_campaigns"\."deleted_at" IS NULL/);
  });

  it('a won field edit still lands', async () => {
    state.readRows = [campaignRow()];
    state.updateReturns = [[{ id: CAMPAIGN }]];
    const res = await patch({ cooldown_days: 5 });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates[0].set).toMatchObject({ cooldownDays: 5 });
  });

  it('an opted-in client whose updatedAt moved is refused before any write', async () => {
    state.readRows = [campaignRow({ updatedAt: new Date('2026-10-05T00:00:00.000Z') })];
    const res = await patch({ status: 'paused', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('Stale data');
    expect(state.updates, 'the guarded write ran anyway').toEqual([]);
  });

  it('a campaign that is not there answers 404 before any write', async () => {
    state.readRows = [];
    const res = await patch({ status: 'paused' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
  });

  it('the claim is this caller’s tenant and row only', async () => {
    state.readRows = [campaignRow()];
    state.updateReturns = [[{ id: CAMPAIGN }]];
    const res = await patch({ status: 'draft' });
    expect(res.status, await res.text()).toBe(200);
    expect(state.updates[0].params).toEqual([CAMPAIGN, TENANT, 'active']);
  });
});
