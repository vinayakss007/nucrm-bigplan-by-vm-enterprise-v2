/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2686 — the search box was the way around record-level RBAC.
 *
 * Four routes already refuse a record the caller may not read: the list adds
 * `assigned_to = me OR created_by = me` without `<entity>.view_all`
 * (`contacts/route.ts:58-60`, `leads/route.ts:90-92`, `deals/route.ts:56-58`,
 * `tasks/route.ts:38-40`), the `[id]` handlers answer 404, the bulk routes were
 * closed in #2671/#2673/#2674, and the CSV exports in #2677. `GET /api/tenant/search`
 * filtered on `tenant_id` and the tombstone and nothing else — so a rep whose
 * contacts page is empty of another rep's rows could type their surname into the
 * header box (`components/tenant/layout/header.tsx:116`) and get name, email and
 * phone back, rendered straight into the dropdown at `:225`.
 *
 * Asserted on the SQL drizzle renders, with `can()` left real: the rule under
 * test is exactly the permission check, so a mocked middleware would grade the
 * mock. Companies stay tenant-wide on purpose — `companies.view_all` is enforced
 * nowhere (#2597), and narrowing only the search would make it stricter than the
 * list, which is the same reasoning #2682 used for the export.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
const mockDb = { select: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy']) builder[m] = chain;
  builder['limit'] = () => builder;
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
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const searchRoute = await import('@/app/api/tenant/search/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function search(ctx: AuthContext, query: string) {
  wheres = [];
  mockDb.select.mockImplementation(() => makeBuilder([]));
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const res = await (searchRoute.GET as (req: NextRequest) => Promise<Response>)(
    new NextRequest(new URL(`/api/tenant/search?${query}`, 'http://localhost:3000'), {
      method: 'GET',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  );
  return res;
}

const clausesOn = (table: string) => wheres.filter(w => w.sql.includes(`"${table}"."tenant_id"`));

/** `assigned_to = me OR created_by = me`, with both halves bound to the caller. */
const ownsBoth = (table: string) => (clause: { sql: string; params: unknown[] }) =>
  new RegExp(`"${table}"\\."assigned_to".*=.*or.*"${table}"\\."created_by".*=`).test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

// The preset a rep gets: view_all off for these four (lib/permissions/definitions.ts:133-135).
const REP = {
  'contacts.view': true, 'deals.view': true, 'tasks.view': true, 'leads.view': true,
};
const MANAGER = {
  ...REP,
  'contacts.view_all': true, 'deals.view_all': true, 'tasks.view_all': true, 'leads.view_all': true,
};

describe('a rep searches only records they may read (#2686)', () => {
  it.each([
    ['contacts', 'type=contacts'],
    ['leads', 'type=leads'],
    ['deals', 'type=deals'],
    ['tasks', 'type=tasks'],
  ])('the %s branch carries its own owner narrowing', async (table, type) => {
    const res = await search(ctxWith(REP), `q=acme&${type}`);
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn(table)[0];
    expect(clause, `no ${table} query rendered`).toBeTruthy();
    expect(ownsBoth(table)(clause), `${table}: ${clause.sql}`).toBe(true);
  });

  it('narrows all five branches in one unfiltered search', async () => {
    const res = await search(ctxWith(REP), 'q=acme');
    expect(res.status, await res.text()).toBe(200);
    expect(wheres).toHaveLength(5);
    for (const table of ['contacts', 'leads', 'deals', 'tasks']) {
      expect(ownsBoth(table)(clausesOn(table)[0]), table).toBe(true);
    }
  });

  it('the narrowing joins the tenant predicate instead of replacing it', async () => {
    await search(ctxWith(REP), 'q=acme&type=contacts');
    const clause = clausesOn('contacts')[0];
    expect(clause.sql).toContain('"contacts"."tenant_id"');
    expect(clause.params).toContain(TENANT);
    expect(clause.sql).toMatch(/"contacts"."deleted_at"/i);
    expect(clause.sql).toMatch(/\band\b/i);
  });

  it('a caller-named owner cannot widen the set back out', async () => {
    // `assigned_to` is not a search param, but the shape is what matters: any
    // filter the client supplies lands in the same AND as the scope.
    await search(ctxWith(REP), 'q=acme&type=deals');
    const clause = clausesOn('deals')[0];
    expect(ownsBoth('deals')(clause)).toBe(true);
    expect(clause.params).not.toContain(OTHER);
  });
});

describe('a view_all holder keeps the tenant-wide search (#2686)', () => {
  it.each([
    ['contacts', 'type=contacts'],
    ['leads', 'type=leads'],
    ['deals', 'type=deals'],
    ['tasks', 'type=tasks'],
  ])('the %s branch drops the ownership predicate entirely', async (table, type) => {
    const res = await search(ctxWith(MANAGER), `q=acme&${type}`);
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn(table)[0];
    // Not merely "narrowed differently": the predicate is gone, and the caller's
    // id is bound nowhere. `q` binds its own pattern per column, so the check is
    // for MINE, not for a param count.
    expect(clause.sql, table).not.toMatch(/"created_by"/);
    expect(clause.params, table).toContain(TENANT);
    expect(clause.params.filter(p => p === MINE), table).toHaveLength(0);
  });

  it('and an empty permission set is not treated as broad', async () => {
    // The negative control: `ownerScope` returns undefined only when `can()`
    // says yes, so a role with nothing granted must read like a rep.
    const res = await search(ctxWith({}), 'q=acme&type=contacts');
    expect(res.status, await res.text()).toBe(200);
    expect(ownsBoth('contacts')(clausesOn('contacts')[0])).toBe(true);
  });
});

describe('companies stay tenant-wide until their view_all means something (#2597)', () => {
  it('the companies branch is not narrowed', async () => {
    const res = await search(ctxWith(REP), 'q=acme&type=companies');
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn('companies')[0];
    expect(clause.sql).not.toMatch(/created_by|assigned_to/);
    expect(clause.params).toContain(TENANT);
    expect(clause.params.filter(p => p === MINE)).toHaveLength(0);
  });
});

describe('search still answers without a query (#2686)', () => {
  it('an empty q runs no query at all, scoped or otherwise', async () => {
    const res = await search(ctxWith(REP), 'q=');
    expect(res.status, await res.text()).toBe(200);
    expect(wheres).toHaveLength(0);
  });
});
