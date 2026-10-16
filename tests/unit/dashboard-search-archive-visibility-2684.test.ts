/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2684 — archiving hid a record everywhere except where you look first.
 *
 * Contacts archive through a column (`contacts.is_archived`, honoured by the
 * list at `app/api/tenant/contacts/route.ts:54` and since #2677 by the export);
 * deals archive through `metadata.archived`, read back by `notArchived()`
 * (`lib/api/deals-archive-filter.ts:28-31`). The header search box
 * (`components/tenant/layout/header.tsx:116`) and every dashboard tile and
 * widget filtered on `tenant_id` and `deleted_at IS NULL` and nothing else. An
 * archived contact stayed findable by name, email and phone; an archived deal
 * kept its value in the pipeline total.
 *
 * Asserted on the SQL each route renders. A canned row set would pass while the
 * query still returned the archived rows, which is how this shipped: these
 * surfaces predate the flags and nothing ever joined them.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect({} as never);

const ARCHIVED_DEAL = /coalesce\("deals"\."metadata"->>'archived', 'false'\) <> 'true'/i;
const ARCHIVED_CONTACT = /"contacts"\."is_archived"/;

let wheres: { sql: string; params: unknown[] }[] = [];
let raw: { sql: string; params: unknown[] }[] = [];
let selections: Record<string, unknown>[] = [];
const mockDb = { select: vi.fn(), execute: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'having']) builder[m] = chain;
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
vi.mock('@/lib/dashboard/widget-cache', () => ({
  withCache: (_t: string, _k: string, _ttl: number, fetcher: () => Promise<Response>) => fetcher(),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const searchRoute = await import('@/app/api/tenant/search/route');
const statsRoute = await import('@/app/api/tenant/dashboard/stats/route');
const contactsCount = await import('@/app/api/tenant/dashboard/widgets/stats/contacts/route');
const pipelineStats = await import('@/app/api/tenant/dashboard/widgets/stats/pipeline/route');
const dealsClosing = await import('@/app/api/tenant/dashboard/widgets/deals/closing/route');
const contactsRecent = await import('@/app/api/tenant/dashboard/widgets/contacts/recent/route');

function setup() {
  vi.resetModules();
  wheres = [];
  raw = [];
  selections = [];
  mockDb.select.mockImplementation((fields?: Record<string, unknown>) => {
    if (fields) selections.push(fields);
    return makeBuilder([]);
  });
  mockDb.execute.mockImplementation((fragment: unknown) => {
    raw.push(dialect.sqlToQuery(fragment as never));
    return Promise.resolve({ rows: [] });
  });
}

async function call(mod: Record<string, unknown>, path: string, query = '') {
  // view_all across the board: this file pins archive visibility only. The owner
  // narrowing #2688 adds on top of these same queries is asserted in
  // tests/unit/dashboard-view-all-scope-2688.test.ts, and letting it land in
  // here would make every raw-SQL shape below depend on a second rule.
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: TENANT,
    roleSlug: 'manager',
    permissions: {
      'contacts.view_all': true, 'deals.view_all': true,
      'tasks.view_all': true, 'leads.view_all': true,
    },
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext);
  const handler = mod.GET as (req: NextRequest) => Promise<Response>;
  return handler(new NextRequest(new URL(`/api/tenant/${path}${query}`, 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  }));
}

/** Every WHERE a route put on `table`, so the asserts do not depend on order. */
const clausesOn = (table: string) => wheres.filter(w => w.sql.includes(`"${table}"."tenant_id"`));

/** Exactly one query on `table`, narrowed by `predicate` — the single-branch case. */
function only(table: string) {
  const hits = clausesOn(table);
  expect(hits, `no ${table} query rendered`).toHaveLength(1);
  return hits[0];
}

const renderedSelection = (key: string) => {
  const withKey = selections.find(f => key in f);
  expect(withKey, `no selection carried ${key}`).toBeTruthy();
  return dialect.sqlToQuery(withKey![key] as never).sql;
};

describe('global search hides what the lists hide (#2684)', () => {
  it('the contacts branch excludes archived contacts', async () => {
    setup();
    await call(searchRoute, 'search', '?q=acme&type=contacts');
    expect(only('contacts').sql).toMatch(ARCHIVED_CONTACT);
    expect(only('contacts').params).toContain(false);
    expect(only('contacts').sql).toMatch(/"contacts"\."deleted_at"/i);
  });

  it('the deals branch excludes archived deals, via the shared predicate', async () => {
    setup();
    await call(searchRoute, 'search', '?q=acme&type=deals');
    expect(only('deals').sql).toMatch(ARCHIVED_DEAL);
  });

  it('a company result does not count archived contacts toward its contact_count', async () => {
    setup();
    await call(searchRoute, 'search', '?q=acme&type=companies');
    // The per-company tally is a correlated subselect in the projection, not in
    // the WHERE, so it has to be rendered from the selection.
    expect(renderedSelection('contact_count')).toMatch(/FROM "contacts".*"contacts"."is_archived" = false/is);
  });

  it('all five branches still run, and only the archive-bearing ones changed', async () => {
    setup();
    const res = await call(searchRoute, 'search', '?q=acme');
    expect(res.status, await res.text()).toBe(200);
    expect(wheres).toHaveLength(5);
    expect(only('contacts').sql).toMatch(ARCHIVED_CONTACT);
    expect(only('deals').sql).toMatch(ARCHIVED_DEAL);
    // Leads and tasks have no archive concept; the tombstone stays their filter.
    for (const table of ['leads', 'tasks']) {
      expect(only(table).sql, table).not.toMatch(/is_archived|archived'/);
      expect(only(table).sql, table).toMatch(/"deleted_at"/);
    }
  });
});

describe('the dashboard tiles count the working set (#2684)', () => {
  it('every stats subselect carries its entity archive predicate', async () => {
    setup();
    await call(statsRoute, 'dashboard/stats');
    const counts = raw[0].sql;
    expect(raw).toHaveLength(1);
    expect(counts.match(/"contacts"\."is_archived" = false/gi)).toHaveLength(2);
    // Four deal figures: pipeline total, deal count, this-month value, won value.
    expect(counts.match(new RegExp(ARCHIVED_DEAL.source, 'gi'))).toHaveLength(4);
    // The tenant still bounds every one of them.
    expect(raw[0].params.filter(p => p === TENANT).length).toBeGreaterThanOrEqual(7);
  });

  it('deals-by-stage and the two recent strips filter too', async () => {
    setup();
    await call(statsRoute, 'dashboard/stats');
    // Two deal reads here — value by stage, and the closing-soon strip — plus
    // one contacts read. None of them may carry an archived row.
    expect(clausesOn('deals').length).toBe(2);
    expect(clausesOn('deals').every(c => ARCHIVED_DEAL.test(c.sql))).toBe(true);
    expect(clausesOn('contacts').every(c => ARCHIVED_CONTACT.test(c.sql))).toBe(true);
  });

  it('the contacts-count widget filters inside its raw template', async () => {
    setup();
    await call(contactsCount, 'dashboard/widgets/stats/contacts');
    expect(raw).toHaveLength(1);
    // Its subselects name no table alias, so the column has to appear bare.
    expect(raw[0].sql).toMatch(/is_archived = false\) AS count/);
    expect(raw[0].sql).toMatch(/is_archived = false AND created_at.*\) AS new_this_month/s);
    expect(raw[0].sql.match(/is_archived = false/g)).toHaveLength(2);
  });

  it('the pipeline widget no longer holds archived value', async () => {
    setup();
    await call(pipelineStats, 'dashboard/widgets/stats/pipeline');
    expect(only('deals').sql).toMatch(ARCHIVED_DEAL);
  });

  it('the closing-this-month strip drops archived deals', async () => {
    setup();
    await call(dealsClosing, 'dashboard/widgets/deals/closing');
    expect(only('deals').sql).toMatch(ARCHIVED_DEAL);
  });

  it('the recent-contacts strip drops archived contacts', async () => {
    setup();
    await call(contactsRecent, 'dashboard/widgets/contacts/recent');
    expect(only('contacts').sql).toMatch(ARCHIVED_CONTACT);
    expect(only('contacts').params).toContain(false);
  });
});

describe('the archive predicates are additive (#2684)', () => {
  it('tenant and tombstone survive on every surface touched', async () => {
    for (const [mod, path] of [
      [searchRoute, 'search?q=acme'],
      [statsRoute, 'dashboard/stats'],
      [pipelineStats, 'dashboard/widgets/stats/pipeline'],
      [dealsClosing, 'dashboard/widgets/deals/closing'],
      [contactsRecent, 'dashboard/widgets/contacts/recent'],
    ] as const) {
      setup();
      await call(mod as unknown as Record<string, unknown>, path as string);
      for (const where of wheres) {
        if (!/"(deals|contacts)"\."tenant_id"/.test(where.sql)) continue;
        expect(where.params, path).toContain(TENANT);
        expect(where.sql, path).toMatch(/deleted_at/i);
      }
    }
  });
});
