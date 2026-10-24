/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3154 — `POST /api/tenant/tasks/bulk` and `POST /api/tenant/companies/bulk`
 * both resolve the caller's ids through a **live-only** query
 * (`deletedAt IS NULL`) and then bail when nothing survives it. Neither exempted
 * `restore`, whose rows are by definition not live, so:
 *
 *  - `{"action":"restore","task_ids":["<trashed>"]}` — the only honest call of
 *    that verb — was answered `404 No valid tasks found` before the switch was
 *    entered; and
 *  - when a caller mixed trashed and live ids, the case DID run, and wrote
 *    `deletedAt = null` over the live set: a no-op UPDATE that still bumped
 *    `updatedAt` and came back as `{"ok":true,"affected":N}`. Success reported
 *    for rows that were never in the trash, and the trashed ones left in it.
 *
 * `deals/bulk:409` and `leads/bulk:306` already carry the fix (#2692): exempt the
 * action at the gate and re-resolve a `deletedAt IS NOT NULL` set in the case,
 * from the caller's id list and under the same owner scope. These two routes now
 * do the same. Neither table has a plan counter or an `is_archived` column, so
 * unlike contacts/leads/deals there is nothing to re-increment and no archive
 * flag to clear — the write stays `deletedAt` / `deletedBy` / `updatedAt`.
 *
 * Asserted on the SQL drizzle renders, because a mocked `db` returns whatever it
 * is told: a canned `{affected: 1}` passes with the tombstone predicate missing
 * entirely, which is precisely how this shipped.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRASHED = '33333333-3333-4333-8333-333333333333';
const LIVE = '44444444-4444-4444-8444-444444444444';
const dialect = new PgDialect({} as never);

type Clause = { sql: string; params: unknown[] };
let wheres: Clause[] = [];
let updates: { table: string; set: Record<string, unknown>; where: Clause; rowCount: number }[] = [];
let selectCall = 0;
let rowsPerCall: unknown[][] = [];
let rowCount = 1;

const mockDb = { select: vi.fn(), update: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params as unknown[] });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

function setup(rows: unknown[][], affected = 1) {
  vi.resetModules();
  wheres = [];
  updates = [];
  selectCall = 0;
  rowsPerCall = rows;
  rowCount = affected;
  mockDb.select.mockImplementation(() => {
    const r = rowsPerCall[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(r);
  });
  mockDb.update.mockImplementation((table: { [Symbol.for('drizzle:Name')]?: string }) => ({
    set: (vals: Record<string, unknown>) => ({
      where: (predicate: unknown) => {
        const rendered = dialect.sqlToQuery(predicate as never);
        updates.push({
          table: table[Symbol.for('drizzle:Name')] ?? '?',
          set: vals,
          where: { sql: rendered.sql, params: rendered.params as unknown[] },
          rowCount,
        });
        return Promise.resolve({ rowCount });
      },
    }),
  }));
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  // Only `requireAuth` is faked: `can()` is what decides the owner scope and `requirePerm`
  // what decides the verb's permission, so both stay real.
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

const ROUTES = {
  tasks: () => import('@/app/api/tenant/tasks/bulk/route'),
  companies: () => import('@/app/api/tenant/companies/bulk/route'),
} as const;

type Route = keyof typeof ROUTES;
async function post(route: Route, body: unknown, ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const { POST } = await ROUTES[route]();
  return POST(new NextRequest(new URL(`/api/tenant/${route}/bulk`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  }));
}

// A rep who may edit but not see the whole tenant: exactly the role the [id]
// handlers refuse. The second set must narrow the same way.
const LIMITED = {
  'tasks.view': true, 'tasks.edit': true, 'tasks.view_all': false,
  'companies.view': true, 'companies.edit': true, 'companies.view_all': false,
};
const BROAD = {
  ...LIMITED, 'tasks.view_all': true, 'companies.view_all': true,
};

const ownsBoth = (col: string) => (clause: Clause) =>
  new RegExp(`"${col}"\\."assigned_to".*=.*or.*"${col}"\\."created_by".*=`).test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

/** The re-resolved trash set: query #2, because #1 is the live validation. */
const restorable = () => wheres[1];

describe.each([
  ['tasks', 'task_ids'],
  ['companies', 'company_ids'],
] as const)('#3154 — POST /api/tenant/%s/bulk restore', (route, idsKey) => {
  const col = route;

  it('a trashed id reaches the case instead of 404ing at the live-only gate', async () => {
    // Query 1 is empty on purpose: the validation is live-only, so the trashed id
    // cannot be in it. At base this response was `404 No valid … found`.
    setup([[], [{ id: TRASHED }]]);
    const res = await post(route, { action: 'restore', [idsKey]: [TRASHED] }, ctxWith(BROAD));
    const body = await res.text();
    expect(res.status, body).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true, affected: 1, action: 'restore' });

    const trash = restorable();
    expect(trash, `only one query ran: ${wheres.map(w => w.sql).join(' | ')}`).toBeTruthy();
    expect(trash!.sql).toMatch(new RegExp(`"${col}"\\."deleted_at" is not null`, 'i'));
    expect(trash!.params).toContain(TRASHED);
    expect(trash!.params).toContain(TENANT);
  });

  it('the UPDATE writes the restorable set, not the live one, and re-asserts the tombstone', async () => {
    setup([[], [{ id: TRASHED }]], 1);
    const res = await post(route, { action: 'restore', [idsKey]: [TRASHED, LIVE] }, ctxWith(BROAD));
    expect(res.status, await res.text()).toBe(200);

    expect(updates).toHaveLength(1);
    const [write] = updates;
    expect(write!.table).toBe(col);
    // `restorable` is empty for the live id under `deleted_at IS NOT NULL`, so the
    // set reaching the UPDATE is the trashed one and nothing else.
    expect(write!.where.params).toEqual(expect.arrayContaining([TRASHED]));
    expect(write!.where.params).not.toContain(LIVE);
    expect(write!.where.sql).toMatch(new RegExp(`"${col}"\\."id" in \\(\\$\\d+\\)`, 'i'));
    // Re-asserted in the UPDATE itself: the set was read a moment ago, and a row
    // restored between the two must not have its `updatedAt` bumped for nothing.
    expect(write!.where.sql).toMatch(new RegExp(`"${col}"\\."deleted_at" is not null`, 'i'));
    // Neither table has an archive flag, so the write stays the tombstone pair.
    expect(Object.keys(write!.set).sort()).toEqual(['deletedAt', 'deletedBy', 'updatedAt']);
    expect(write!.set.deletedAt).toBe(null);
    expect(write!.set.deletedBy).toBe(null);
  });

  it('the count the caller sees is the rows actually restored', async () => {
    setup([[], [{ id: TRASHED }, { id: TRASHED }]], 0);
    const res = await post(route, { action: 'restore', [idsKey]: [TRASHED] }, ctxWith(BROAD));
    const body = await res.text();
    expect(res.status, body).toBe(200);
    // `rowCount` is the truth the UPDATE returns; reporting the id list's length
    // instead is what made the old no-op look like a success.
    expect(JSON.parse(body).affected).toBe(0);
  });

  it('a restore that finds nothing in the trash answers 404 and writes nothing', async () => {
    setup([[], []]);
    const res = await post(route, { action: 'restore', [idsKey]: [LIVE] }, ctxWith(BROAD));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/deleted .*found to restore/i);
    expect(updates).toHaveLength(0);
  });

  it('the second set is owner-scoped, so another rep\'s trash is not restorable', async () => {
    setup([[], []]);
    const res = await post(route, { action: 'restore', [idsKey]: [TRASHED] }, ctxWith(LIMITED));
    expect(res.status).toBe(404);
    const trash = restorable()!;
    // tasks narrows through ownerScope; companies/bulk carries no owner scope on
    // any of its sets, as no `companies` read does — `companies.view_all` is
    // defined and enforced nowhere, which #2597 tracks. Only the tenant +
    // tombstone pair applies there.
    if (route === 'tasks') {
      expect(ownsBoth(col)(trash), `no ownership predicate: ${trash.sql}`).toBe(true);
    } else {
      expect(trash.sql).not.toMatch(/assigned_to|created_by/);
    }
    expect(trash.params).toContain(TENANT);
  });

  it('a view_all holder keeps the tenant-wide restore', async () => {
    setup([[], [{ id: TRASHED }]]);
    const res = await post(route, { action: 'restore', [idsKey]: [TRASHED] }, ctxWith(BROAD));
    expect(res.status, await res.text()).toBe(200);
    expect(restorable()!.sql).not.toMatch(/created_by/);
  });

  it('every other action still refuses at the gate — the exemption is restore-only', async () => {
    setup([[]]);
    const action = route === 'tasks' ? 'priority' : 'status';
    const res = await post(route, { action, [idsKey]: [TRASHED] }, ctxWith(BROAD));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no valid/i);
    expect(wheres).toHaveLength(1);
    expect(updates).toHaveLength(0);
  });

  it('a select-all restore cannot quietly write the live rows it enumerated', async () => {
    // The select-all enumeration is live-only too, so this is the shape that used
    // to reach the UPDATE with a set of rows that were never deleted. It now
    // resolves nothing restorable and answers 404.
    setup([[{ id: LIVE }], [], []]);
    const res = await post(route, { action: 'restore', selectAll: true, filters: {} }, ctxWith(BROAD));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/deleted .*found to restore/i);
    expect(updates).toHaveLength(0);
  });
});
