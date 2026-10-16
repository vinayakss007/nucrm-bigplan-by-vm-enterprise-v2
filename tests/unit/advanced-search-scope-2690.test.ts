/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2690 — the second search surface kept reading the whole tenant.
 *
 * `app/api/tenant/search/advanced/route.ts` is the Filters panel
 * (`app/tenant/search/page.tsx:131`, `components/tenant/advanced-search.tsx:106`).
 * #2686 narrowed its sibling `GET /search`; this file was not in that diff. Its
 * five `case` branches build `conditions` out of `tenant_id` plus whatever the
 * caller picked (`:81-83`, `:154-156`, `:229-231`, `:298-300`, `:352-354`) and
 * never mention `view_all` (the file does not import `ownerScope`), never
 * mention `contacts.is_archived` or `notArchived()` for deals, and — unlike the
 * three cases above them — never mention `deleted_at` for tasks or companies.
 * So a rep whose contacts page, export, dashboard and search box all refuse
 * another rep's rows gets those rows, plus archived records and trashed
 * records, from the Filters panel, together with a `pagination.total` counting
 * what they cannot open.
 *
 * Asserted on the SQL drizzle renders, with `can()` left real: the rule under
 * test is exactly the permission check, so a mocked middleware would grade the
 * mock. Each type issues a row query and a count query off the same `where`, so
 * both are checked — a scope that leaked only through `total` would still be a
 * leak. Companies stay tenant-wide on purpose: `companies.view_all` is enforced
 * nowhere (#2597), and narrowing only this route would make it stricter than
 * the list beside it.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
const mockDb = { select: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy']) builder[m] = chain;
  builder['limit'] = () => builder;
  builder['offset'] = () => builder;
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
const advanced = await import('@/app/api/tenant/search/advanced/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function run(ctx: AuthContext, body: Record<string, unknown>) {
  wheres = [];
  mockDb.select.mockImplementation(() => makeBuilder([]));
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return (advanced.POST as (req: NextRequest) => Promise<Response>)(
    new NextRequest(new URL('/api/tenant/search/advanced', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify(body),
    }),
  );
}

const clausesOn = (table: string) => wheres.filter(w => w.sql.includes(`"${table}"."tenant_id"`));

/** `assigned_to = me OR created_by = me`, both halves bound to the caller. */
const ownsBoth = (table: string) => (clause: { sql: string; params: unknown[] }) =>
  new RegExp(`"${table}"\\."assigned_to".*=.*or.*"${table}"\\."created_by".*=`).test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

const REP = {
  'contacts.view': true, 'deals.view': true, 'tasks.view': true, 'leads.view': true,
};
const MANAGER = {
  ...REP,
  'contacts.view_all': true, 'deals.view_all': true, 'tasks.view_all': true, 'leads.view_all': true,
};

describe('a rep advanced-searches only records they may read (#2690)', () => {
  it.each([
    ['contacts', 'contacts'],
    ['leads', 'leads'],
    ['deals', 'deals'],
    ['tasks', 'tasks'],
  ])('the %s branch carries its owner narrowing', async (type, table) => {
    const res = await run(ctxWith(REP), { query: 'acme', type });
    expect(res.status, await res.text()).toBe(200);
    // Two reads share the where: the page of rows and the count behind
    // pagination.total. Both have to be narrowed.
    const clauses = clausesOn(table);
    expect(clauses.length, `${type}: rendered clauses`).toBeGreaterThanOrEqual(2);
    for (const clause of clauses) expect(ownsBoth(table)(clause), `${type}: ${clause.sql}`).toBe(true);
  });

  it('keeps the narrowing when the caller also picks filters', async () => {
    const res = await run(ctxWith(REP), {
      type: 'contacts',
      filters: { status: ['new'], source: ['referral'], dateFrom: '2026-01-01' },
    });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn('contacts')[0];
    expect(ownsBoth('contacts')(clause), clause.sql).toBe(true);
    expect(clause.sql).toMatch(/"contacts"."lead_status"/);
    expect(clause.sql).toMatch(/"contacts"."lead_source"/);
  });

  it('a stage filter does not displace the deals scope', async () => {
    const res = await run(ctxWith(REP), { type: 'deals', filters: { stage: ['won'] } });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn('deals')[0];
    expect(ownsBoth('deals')(clause), clause.sql).toBe(true);
    expect(clause.sql).toMatch(/deal_stages/);
  });
});

describe('advanced search hides what the lists hide (#2690)', () => {
  it('drops archived contacts, which contacts/route.ts:54 hides', async () => {
    const res = await run(ctxWith(MANAGER), { type: 'contacts', query: 'acme' });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn('contacts')[0];
    expect(clause.sql).toMatch(/"contacts"."is_archived"/);
    expect(clause.params).toContain(false);
  });

  it('drops archived deals, which deals/route.ts:53 hides', async () => {
    const res = await run(ctxWith(MANAGER), { type: 'deals', query: 'acme' });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn('deals')[0];
    expect(clause.sql).toMatch(/metadata/i);
    expect(clause.sql).toMatch(/'archived'/);
  });

  it.each([
    ['tasks', 'tasks'],
    ['companies', 'companies'],
  ])('the %s branch drops trashed rows, unlike the file it sits in', async (type, table) => {
    const res = await run(ctxWith(MANAGER), { type, query: 'acme' });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn(table)[0];
    expect(clause.sql, clause.sql).toMatch(/"deleted_at" is null/i);
  });

  it.each([
    ['contacts', 'contacts'],
    ['deals', 'deals'],
    ['leads', 'leads'],
  ])('%s keeps the tombstone it already had', async (type, table) => {
    const res = await run(ctxWith(MANAGER), { type, query: 'acme' });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn(table)[0];
    expect(clause.sql).toMatch(/"deleted_at" is null/i);
  });
});

describe('a view_all holder keeps the tenant-wide read (#2690)', () => {
  it.each([
    ['contacts', 'contacts'],
    ['leads', 'leads'],
    ['deals', 'deals'],
    ['tasks', 'tasks'],
  ])('%s: no owner predicate for a manager', async (type, table) => {
    const res = await run(ctxWith(MANAGER), { type, query: 'acme' });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn(table)[0];
    expect(clause.sql, clause.sql).not.toMatch(/"created_by"/);
    expect(clause.params.filter(p => p === MINE)).toHaveLength(0);
  });

  it('companies stays tenant-wide — its view_all is enforced nowhere (#2597)', async () => {
    const res = await run(ctxWith(REP), { type: 'companies', query: 'acme' });
    expect(res.status, await res.text()).toBe(200);
    const clause = clausesOn('companies')[0];
    expect(clause.sql).not.toMatch(/"companies"."created_by"/);
  });
});
