/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized distribution is prohibited.
 */

/**
 * #2688 — the dashboard was the last surface that read the whole tenant.
 *
 * The lists add `assigned_to = me OR created_by = me` when the caller lacks the
 * entity's `view_all` (`contacts/route.ts:58-60`, `deals/route.ts:56-58`,
 * `tasks/route.ts:38-40`, `leads/route.ts:90-92`; the `sales_rep` preset at
 * `lib/permissions/definitions.ts:133-135` turns three of them off). The bulk
 * routes were closed in #2671/#2673/#2674, the CSV exports in #2677, global
 * search in #2686. `GET /dashboard/stats` and six widgets still filtered on
 * `tenant_id` and the tombstone — so a rep's home page listed another rep's
 * contacts with their emails, another rep's closing deals with their values, and
 * counted the whole workspace in tiles the rep cannot itemise.
 *
 * Every case is asserted twice over: on the SQL drizzle renders (or the raw
 * template, for the four `db.execute` counts), and on the cache key the route
 * hands `withCache`. A route can carry the right predicate and still be answered
 * from the first caller of the TTL window — `tests/unit/widget-cache-scope-key-2688.test.ts`
 * pins that half.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let raw: { sql: string; params: unknown[] }[] = [];
let cacheArgs: { widgetKey: string; scopeKey: string | undefined }[] = [];
const mockDb = { select: vi.fn(), execute: vi.fn() };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'having']) builder[m] = chain;
  builder['limit'] = () => builder;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve([]);
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  // `can()` is the rule under test, so only `requireAuth` is faked.
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/dashboard/widget-cache', () => ({
  withCache: (_t: string, widgetKey: string, _ttl: number, fetcher: () => Promise<Response>, scopeKey?: string) => {
    cacheArgs.push({ widgetKey, scopeKey });
    return fetcher();
  },
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const statsRoute = await import('@/app/api/tenant/dashboard/stats/route');
const contactsRecent = await import('@/app/api/tenant/dashboard/widgets/contacts/recent/route');
const dealsClosing = await import('@/app/api/tenant/dashboard/widgets/deals/closing/route');
const tasksList = await import('@/app/api/tenant/dashboard/widgets/tasks/route');
const statsPipeline = await import('@/app/api/tenant/dashboard/widgets/stats/pipeline/route');
const statsContacts = await import('@/app/api/tenant/dashboard/widgets/stats/contacts/route');
const statsTasks = await import('@/app/api/tenant/dashboard/widgets/stats/tasks/route');
const widgetLeads = await import('@/app/api/tenant/dashboard/widgets/leads/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function setup() {
  vi.resetModules();
  wheres = [];
  raw = [];
  cacheArgs = [];
  mockDb.select.mockImplementation(() => makeBuilder());
  mockDb.execute.mockImplementation((fragment: unknown) => {
    raw.push(dialect.sqlToQuery(fragment as never));
    return Promise.resolve({ rows: [] });
  });
}

async function get(mod: Record<string, unknown>, path: string, ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  return (mod.GET as (req: NextRequest) => Promise<Response>)(
    new NextRequest(new URL(`/api/tenant/${path}`, 'http://localhost:3000'), {
      method: 'GET',
      headers: { 'x-forwarded-for': '127.0.0.1' },
    }),
  );
}

const owns = (table: string) => (c: { sql: string; params: unknown[] }) =>
  new RegExp(`"${table}"\\."assigned_to".*=.*or.*"${table}"\\."created_by".*=`).test(c.sql)
  && c.params.filter(p => p === MINE).length === 2;

const clausesOn = (table: string) => wheres.filter(w => w.sql.includes(`"${table}"."tenant_id"`));
const rawText = () => raw.map(r => r.sql).join('\n');

// What a rep holds: view on everything, view_all on nothing.
const REP = {
  'contacts.view': true, 'deals.view': true, 'tasks.view': true, 'leads.view': true,
};
const MANAGER = {
  ...REP,
  'contacts.view_all': true, 'deals.view_all': true, 'tasks.view_all': true, 'leads.view_all': true,
};

interface Surface {
  label: string;
  mod: Record<string, unknown>;
  path: string;
  table: string;
  /** How the route reaches the database: a builder WHERE or a raw template. */
  via: 'where' | 'raw';
}

const SURFACES: Surface[] = [
  { label: 'recent-contacts widget', mod: contactsRecent, path: 'dashboard/widgets/contacts/recent', table: 'contacts', via: 'where' },
  { label: 'deals-closing widget', mod: dealsClosing, path: 'dashboard/widgets/deals/closing', table: 'deals', via: 'where' },
  { label: 'tasks-list widget', mod: tasksList, path: 'dashboard/widgets/tasks', table: 'tasks', via: 'where' },
  { label: 'pipeline stats widget', mod: statsPipeline, path: 'dashboard/widgets/stats/pipeline', table: 'deals', via: 'where' },
  { label: 'contacts stats widget', mod: statsContacts, path: 'dashboard/widgets/stats/contacts', table: 'contacts', via: 'raw' },
  { label: 'tasks stats widget', mod: statsTasks, path: 'dashboard/widgets/stats/tasks', table: 'tasks', via: 'raw' },
  { label: 'leads widget', mod: widgetLeads, path: 'dashboard/widgets/leads', table: 'leads', via: 'raw' },
];

describe('each dashboard surface narrows like its own list (#2688)', () => {
  it.each(SURFACES)('$label narrows for a rep without view_all', async (s) => {
    setup();
    const res = await get(s.mod, s.path, ctxWith(REP));
    expect(res.status, await res.text()).toBe(200);
    if (s.via === 'where') {
      const clauses = clausesOn(s.table);
      expect(clauses.length, s.label).toBeGreaterThan(0);
      expect(clauses.every(owns(s.table)), `${s.label}: ${clauses[0].sql}`).toBe(true);
    } else {
      expect(raw.length, s.label).toBeGreaterThan(0);
      expect(rawText(), s.label).toContain(`"${s.table}"."assigned_to"`);
      expect(rawText(), s.label).toContain(`"${s.table}"."created_by"`);
      expect(raw[0].params.filter(p => p === MINE).length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(SURFACES)('$label stays tenant-wide for a view_all holder', async (s) => {
    setup();
    const res = await get(s.mod, s.path, ctxWith(MANAGER));
    expect(res.status, await res.text()).toBe(200);
    if (s.via === 'where') {
      expect(clausesOn(s.table).every(c => !/"created_by"/.test(c.sql)), s.label).toBe(true);
    } else {
      expect(rawText(), s.label).not.toMatch(/"created_by"/);
    }
    // The tenant still bounds the read either way.
    const params = s.via === 'where' ? clausesOn(s.table).flatMap(c => c.params) : raw.flatMap(r => r.params);
    expect(params, s.label).toContain(TENANT);
  });

  it('the combined stats route narrows contacts, deals and tasks alike', async () => {
    setup();
    const res = await get(statsRoute, 'dashboard/stats', ctxWith(REP));
    expect(res.status, await res.text()).toBe(200);
    for (const table of ['contacts', 'deals', 'tasks']) {
      expect(clausesOn(table).length, table).toBeGreaterThan(0);
      expect(clausesOn(table).every(owns(table)), table).toBe(true);
    }
    // Its six raw counts, one per figure the tiles show.
    for (const table of ['contacts', 'deals', 'tasks']) {
      expect(rawText(), table).toContain(`"${table}"."assigned_to"`);
    }
    expect(raw[0].params.filter(p => p === MINE).length).toBeGreaterThanOrEqual(6);
  });

  it('the combined stats route keeps the tenant-wide read for a manager', async () => {
    setup();
    await get(statsRoute, 'dashboard/stats', ctxWith(MANAGER));
    expect(wheres.some(w => /"created_by"/.test(w.sql))).toBe(false);
    expect(rawText()).not.toMatch(/"created_by"/);
  });

  it('the spliced fragment leaves valid SQL on both sides (#2688)', async () => {
    // These routes read through `db.execute(sql`...`)`, where the scope has to be
    // spliced after the last term of a WHERE. Without a leading space in the
    // fragment a rep gets `is_archived = falseAND (...)`, which Postgres rejects;
    // with a trailing one a manager gets `is_archived = false AND ... ) ` and the
    // tile 500s on the stray token. Both shapes are pinned here.
    setup();
    await get(statsContacts, 'dashboard/widgets/stats/contacts', ctxWith(REP));
    expect(rawText()).toMatch(/is_archived = false AND \("contacts"\."assigned_to"/);

    setup();
    await get(statsContacts, 'dashboard/widgets/stats/contacts', ctxWith(MANAGER));
    expect(rawText()).toMatch(/is_archived = false\) AS count/);
  });

  it('companies stay tenant-wide until their view_all is enforced somewhere (#2597)', async () => {
    setup();
    await get(statsRoute, 'dashboard/stats', ctxWith(REP));
    // Slice out the one subselect rather than the whole template: with /s a
    // greedy match would let the contacts scope next door "prove" the point.
    const companiesSlice = rawText().match(/FROM "companies".*?AS company_count/s)?.[0];
    expect(companiesSlice, 'no companies count rendered').toBeTruthy();
    expect(companiesSlice).not.toMatch(/created_by|assigned_to/);
    // The raw templates name no table alias, so the tenant bound is bare.
    expect(companiesSlice).toMatch(/WHERE tenant_id = \$\d+ AND deleted_at IS NULL\)/);
  });
});

describe('the widgets ask for their own cache entry (#2688)', () => {
  it.each(SURFACES)('$label passes the caller as the scope key', async (s) => {
    setup();
    await get(s.mod, s.path, ctxWith(REP));
    expect(cacheArgs).toHaveLength(1);
    expect(cacheArgs[0].scopeKey, s.label).toBe(MINE);
  });

  it.each(SURFACES)('$label shares one entry for view_all holders', async (s) => {
    setup();
    await get(s.mod, s.path, ctxWith(MANAGER));
    expect(cacheArgs[0].scopeKey, s.label).toBe('tenant');
  });

  it('the scope key follows the entity whose permission is in play', async () => {
    // A rep who has been promoted for deals only must not have their contacts
    // tile keyed as tenant-wide, or the narrowing above is undone by the cache.
    setup();
    await get(statsContacts, 'dashboard/widgets/stats/contacts', ctxWith({ ...REP, 'deals.view_all': true }));
    expect(cacheArgs[0].scopeKey).toBe(MINE);
    setup();
    await get(statsPipeline, 'dashboard/widgets/stats/pipeline', ctxWith({ ...REP, 'deals.view_all': true }));
    expect(cacheArgs[0].scopeKey).toBe('tenant');
  });
});
