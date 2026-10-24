/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2671 — bulk deals were scoped by tenant, and by nothing that mattered.
 *
 * `GET/PATCH/DELETE /api/tenant/deals/[id]` all answer 404 to a user who lacks
 * `deals.view_all` when the deal is not theirs (`deals/[id]/route.ts:66-71`,
 * `:159-164`, `:310-317`), and the list narrows the same way
 * (`deals/route.ts:56-58`). `POST /api/tenant/deals/bulk` did not mention
 * `view_all` at all: every id set it acts on was scoped by tenant + tombstone
 * only. So a rep who cannot open another rep's deal could reassign, re-stage,
 * close, archive, segment or delete it — through "select all matching" (which
 * enumerates the whole tenant) or by naming ids directly.
 *
 * Asserted on the SQL drizzle renders. A mocked `db` returns whatever it is told,
 * so a canned `[{affected: 1}]` passes with no ownership predicate anywhere —
 * which is exactly how this shipped.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEAL = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let selectCall = 0;
let rowsPerCall: unknown[][] = [];
const mockDb = { select: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  // Only `requireAuth` is faked: `can()` is the rule under test and stays real.
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', async (importOriginal) => ({
  // #3220: only the writer is faked — `bulkIdsAudit` is the shape under test,
  // so a mock that omits it turns every bulk route into a 500.
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  logAudit: vi.fn(),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
  enforceFieldRead: (_ctx: unknown, _entity: string, rows: unknown[]) => Promise.resolve(rows),
}));

const { requireAuth } = await import('@/lib/auth/middleware');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function setup(rows: unknown[][]) {
  vi.resetModules();
  wheres = [];
  selectCall = 0;
  rowsPerCall = rows;
  mockDb.select.mockImplementation(() => {
    const r = rowsPerCall[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(r);
  });
}

async function post(body: unknown, ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const { POST } = await import('@/app/api/tenant/deals/bulk/route');
  return POST(new NextRequest(new URL('/api/tenant/deals/bulk', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  }));
}

// A rep with no `deals.view_all`: exactly the role the [id] handlers refuse.
const LIMITED = { 'deals.view': true, 'deals.edit': true, 'deals.assign': true };
// The same rep promoted: the predicate must disappear, not merely be joined in.
const BROAD = { ...LIMITED, 'deals.view_all': true };

const ownsBoth = (clause: { sql: string; params: unknown[] }) =>
  /"deals"\."assigned_to".*=.*or.*"deals"\."created_by".*=/.test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

describe('select-all matching is scoped to deals the caller may touch (#2671)', () => {
  it('the tenant-wide enumeration becomes an owner-scoped one', async () => {
    setup([[{ id: DEAL }], [{ id: DEAL }]]);
    const res = await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(LIMITED));
    // `payload.assigned_to` is absent, so the handler stops before writing — after
    // both id sets have already been resolved, which is what is being pinned.
    expect(res.status, await res.text()).toBe(400);

    const enumerated = wheres[0];
    expect(enumerated.sql).toContain('"deals"."tenant_id"');
    expect(enumerated.sql).toMatch(/"deals"\."deleted_at" is null/i);
    expect(ownsBoth(enumerated), `no ownership predicate: ${enumerated.sql}`).toBe(true);
  });

  it('a client cannot widen it back by naming another owner', async () => {
    setup([[{ id: DEAL }], [{ id: DEAL }]]);
    const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await post({ action: 'assign', selectAll: true, filters: { assigned_to: OTHER } }, ctxWith(LIMITED));
    // The caller's `assigned_to` lands in the same AND as the scope, so it can
    // only narrow the set further — naming somebody else never re-widens it to
    // the whole tenant, and never replaces the narrowing.
    expect(ownsBoth(wheres[0]), `no ownership predicate: ${wheres[0].sql}`).toBe(true);
    expect(wheres[0].params).toContain(OTHER);
    expect(wheres[0].sql).toMatch(/\band\b/i);
  });

  it('a user with deals.view_all keeps the whole-tenant scope', async () => {
    setup([[{ id: DEAL }], [{ id: DEAL }]]);
    await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(BROAD));
    expect(wheres[0].sql).not.toMatch(/"deals"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT]);
  });
});

describe('an explicit deal_ids list is validated against the same scope (#2671)', () => {
  it('the id validation refuses deals the caller does not own', async () => {
    setup([[{ id: DEAL }]]);
    const res = await post({ action: 'assign', deal_ids: [DEAL] }, ctxWith(LIMITED));
    expect(res.status, await res.text()).toBe(400);
    expect(ownsBoth(wheres[0]), `no ownership predicate: ${wheres[0].sql}`).toBe(true);
    expect(wheres[0].sql).toContain('"deals"."id" in');
  });

  it('selecting all leaves nothing outside the scope to validate', async () => {
    // Both paths must narrow, or `selectAll` + a foreign id smuggles the row past
    // whichever one is unguarded.
    setup([[{ id: DEAL }], [{ id: DEAL }]]);
    await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(LIMITED));
    expect(wheres).toHaveLength(2);
    expect(wheres.every(ownsBoth)).toBe(true);
  });
});

describe('restore is a write to the deal, so it is scoped too (#2671)', () => {
  it('another rep\'s trashed deal is not restorable', async () => {
    // Query 1 (live validation) is empty on purpose: `restore` re-resolves
    // against deletedAt IS NOT NULL, which is the query under test.
    setup([[], []]);
    const res = await post({ action: 'restore', deal_ids: [DEAL] }, ctxWith(LIMITED));
    expect(res.status, await res.text()).toBe(404);
    const restorable = wheres[1];
    expect(restorable.sql).toMatch(/"deals"\."deleted_at" is not null/i);
    expect(ownsBoth(restorable), `no ownership predicate: ${restorable.sql}`).toBe(true);
  });

  it('the broad role can still restore across the tenant', async () => {
    setup([[], []]);
    await post({ action: 'restore', deal_ids: [DEAL] }, ctxWith(BROAD));
    expect(wheres[1].sql).toMatch(/"deals"\."deleted_at" is not null/i);
    expect(wheres[1].sql).not.toMatch(/"deals"\."created_by"/);
  });
});
