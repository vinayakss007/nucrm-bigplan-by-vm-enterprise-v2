/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3342 — the two instances #3194 left behind:
 *
 *  - `DELETE /api/tenant/meetings/[id]` read the row under `id + tenant +
 *    isNull(deletedAt)`, then tombstoned with `WHERE id = <id>` alone — no
 *    tenant clause, no tombstone gate, no read-back: a vanished row still
 *    answered `{ok:true}`. The sibling PATCH in the same file already claimed
 *    properly; this was the family's worst remaining offender.
 *  - `PATCH /api/tenant/views/[id]` vetted tenant, tombstone, AND owner in JS,
 *    then wrote `.where(eq(savedViews.id, id))` — dropping all three for
 *    whatever landed in the check-then-write gap. Its own DELETE was already
 *    hardened per #3194; the PATCH never followed.
 *
 * DB-free harness, the shape the family tests reuse: UPDATE WHEREs are
 * rendered to SQL through `PgDialect` (a mock call count cannot show a missing
 * predicate) and `.returning()` is replayed empty to show the handlers honour
 * a lost claim with 404 instead of a false success. `concurrencyGuard` stays
 * real on the views path — its opt-in pass-through is part of what is proven.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_USER = 'cccccccc-cccc-4ccc-8cc-cccccccccccc';
const MEETING = '33333333-3333-4333-8333-333333333333';
const VIEW = '44444444-4444-4444-8444-444444444444';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  readRows: [] as unknown[],
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
    builder['leftJoin'] = () => builder;
    builder['orderBy'] = () => builder;
    return builder;
  },
};

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: {},
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx), requirePerm: vi.fn(() => null), can: vi.fn(() => true) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  validateBody: vi.fn(async (_schema: unknown, body: unknown) => ({ data: body })),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((err: unknown) => { throw err; }),
  notFound: (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 }),
  forbidden: (msg: string) => NextResponse.json({ error: msg }, { status: 403 }),
}));

beforeEach(() => {
  vi.resetModules();
  state.readRows = [];
  state.updateReturns = [];
  state.updates = [];
  ctx.userId = USER;
  ctx.isAdmin = false;
  ctx.isSuperAdmin = false;
});

function meetingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: MEETING, tenantId: TENANT, userId: USER, title: 'Weekly sync',
    status: 'scheduled', deletedAt: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'), ...over,
  };
}

function viewRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: VIEW, tenantId: TENANT, userId: USER, name: 'Open deals',
    filters: {}, columns: [], isShared: false, isDefault: false,
    deletedAt: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'), ...over,
  };
}

async function deleteMeeting() {
  const { DELETE } = await import('@/app/api/tenant/meetings/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/meetings/${MEETING}`, 'http://localhost:3000'), {
    method: 'DELETE', headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: MEETING }) },
  );
}

async function patchView(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/tenant/views/[id]/route');
  const req = new NextRequest(new URL(`/api/tenant/views/${VIEW}`, 'http://localhost:3000'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
  return (PATCH as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id: VIEW }) },
  );
}

describe('meetings DELETE claims what its read vetted (#3342)', () => {
  it('the tombstone write names the tenant and the tombstone gate, and answers from the read-back', async () => {
    state.readRows = [meetingRow()];
    state.updateReturns = [[{ id: MEETING }]];
    const res = await deleteMeeting();
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.parse(said)).toEqual({ ok: true });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql).toMatch(/"meetings"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"meetings"\."deleted_at" is null/i);
    expect(state.updates[0].params).toEqual([MEETING, TENANT]);
    expect(state.updates[0].set.deletedAt).toBeInstanceOf(Date);
  });

  it('a row that vanished or was tombstoned in the gap answers 404, not a false ok:true', async () => {
    state.readRows = [meetingRow()];
    state.updateReturns = [[]];
    const res = await deleteMeeting();
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(JSON.parse(said).error).toContain('Meeting not found');
    expect(state.updates).toHaveLength(1);
  });

  it('a meeting the caller cannot see answers 404 before any write', async () => {
    state.readRows = [];
    const res = await deleteMeeting();
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
  });
});

describe('views PATCH re-asserts tenant, tombstone, and owner (#3342)', () => {
  it('a non-admin write claims the owner alongside tenant and tombstone', async () => {
    state.readRows = [viewRow()];
    state.updateReturns = [[{ id: VIEW }]];
    const res = await patchView({ name: 'Renamed' });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql).toMatch(/"saved_views"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"saved_views"\."deleted_at" is null/i);
    expect(state.updates[0].sql).toMatch(/"saved_views"\."user_id"/);
    expect(state.updates[0].params).toEqual([VIEW, TENANT, USER]);
    expect(state.updates[0].set).toMatchObject({ name: 'Renamed' });
  });

  it('an admin write drops only the owner claim — tenant and tombstone stay', async () => {
    state.readRows = [viewRow({ userId: OTHER_USER })];
    state.updateReturns = [[{ id: VIEW }]];
    ctx.userId = ADMIN_USER;
    ctx.isAdmin = true;
    const res = await patchView({ is_shared: true });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.updates[0].sql).toMatch(/"saved_views"\."tenant_id"/);
    expect(state.updates[0].sql).toMatch(/"saved_views"\."deleted_at" is null/i);
    expect(state.updates[0].sql, 'an admin edit claimed a different owner').not.toMatch(/"saved_views"\."user_id"/);
    expect(state.updates[0].params).toEqual([VIEW, TENANT]);
  });

  it('a view deleted or re-owned in the gap answers 404, not a fabricated success', async () => {
    // Before #3342 this rendered `WHERE id` alone, matched the row anyway, and
    // returned 200 even when the row was gone; and any concurrent gain of the
    // owner condition was invisible to the write.
    state.readRows = [viewRow()];
    state.updateReturns = [[]];
    const res = await patchView({ filters: { stage: 'won' } });
    const said = await res.text();
    expect(res.status, said).toBe(404);
    expect(JSON.parse(said).error).toContain('View');
    expect(state.updates).toHaveLength(1);
  });

  it('a non-owner is still refused 403 before any write — the JS vet keeps its job', async () => {
    state.readRows = [viewRow({ userId: OTHER_USER })];
    const res = await patchView({ name: 'Stolen rename' });
    const said = await res.text();
    expect(res.status, said).toBe(403);
    expect(state.updates, 'the refused edit still landed').toEqual([]);
  });

  it('a view the caller cannot see answers 404 before any write', async () => {
    state.readRows = [];
    const res = await patchView({ name: 'x' });
    expect(res.status, await res.text()).toBe(404);
    expect(state.updates).toEqual([]);
  });

  it('the default client is covered: no expectedUpdatedAt, no opt-in, still claimed', async () => {
    // `concurrencyGuard` is REAL here — it passes a body that never mentions it,
    // and the claim in the WHERE is what protects the write.
    state.readRows = [viewRow()];
    state.updateReturns = [[{ id: VIEW }]];
    const res = await patchView({ is_default: true });
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(JSON.stringify(state.updates[0].params)).not.toContain('expectedUpdatedAt');
    expect(state.updates[0].params).toEqual([VIEW, TENANT, USER]);
  });

  it('an opted-in client whose updatedAt moved is refused before any write', async () => {
    state.readRows = [viewRow({ updatedAt: new Date('2026-10-05T00:00:00.000Z') })];
    const res = await patchView({ name: 'x', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' });
    const said = await res.text();
    expect(res.status, said).toBe(409);
    expect(JSON.parse(said).error).toContain('Stale data');
    expect(state.updates, 'the guarded write ran anyway').toEqual([]);
  });
});
