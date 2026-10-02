/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Two crash-class bugs the super admin console sweep (gen-11) found by loading
 * the panel with real data, pinned here as SQL-shape assertions.
 *
 * 1. /api/superadmin/search cast nothing when it put a uuid column into an
 *    ILIKE, and Postgres has no `uuid ~~* unknown` operator — so the global
 *    search box answered 500 for *every* query longer than two characters.
 * 2. /api/superadmin/data-explorer built its per-tenant predicate as
 *    `<alias>.tenant_id` for all six tabs, but `tenants` and `users` have no
 *    tenant_id column (membership lives in tenant_members), so the tenants and
 *    users tabs 500'd with `column t.tenant_id does not exist`.
 *
 * Both are asserted by compiling the built query to SQL text rather than
 * against a live database, because the failure is exactly the text produced.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const whereFragments: unknown[] = [];
const executedQueries: unknown[] = [];

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = (fragment: unknown) => {
        whereFragments.push(fragment);
        return chain;
      };
      chain.orderBy = () => chain;
      chain.limit = () => Promise.resolve([]);
      return chain;
    },
    execute: (query: unknown) => {
      executedQueries.push(query);
      return Promise.resolve({ rows: [{ count: '0' }] });
    },
  },
}));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ userId: 'admin-1', email: 'a@b.c', isSuperAdmin: true }),
}));
vi.mock('@/lib/audit/super-admin', () => ({ logSuperAdminAction: async () => undefined }));
vi.mock('@/lib/errors-server', () => ({ logError: async () => undefined }));

const dialect = new PgDialect();

const { GET: SEARCH } = await import('@/app/api/superadmin/search/route');
const { GET: EXPLORER } = await import('@/app/api/superadmin/data-explorer/route');

function reset() {
  whereFragments.length = 0;
  executedQueries.length = 0;
}

function render(fragment: unknown): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment as never);
  return { sql: query.sql, params: query.params };
}

async function search(qs: string): Promise<Response> {
  return SEARCH(new Request(`http://x/api/superadmin/search?${qs}`) as never);
}

async function explore(qs: string): Promise<Response> {
  return EXPLORER(new Request(`http://x/api/superadmin/data-explorer?${qs}`) as never);
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

describe('superadmin global search on uuid columns', () => {
  it('casts the uuid columns to text before ILIKE-ing them', async () => {
    reset();
    await search(`q=siraoi&limit=5`);
    expect(whereFragments).toHaveLength(2);

    const [tenantsWhere, usersWhere] = whereFragments.map(render);
    expect(tenantsWhere.sql).toMatch(/::text ilike/i);
    expect(usersWhere.sql).toMatch(/::text ilike/i);
  });

  it('never puts a bare uuid column on the left of an ILIKE', async () => {
    reset();
    await search('q=siraoi');
    // Postgres resolves ILIKE against text/unknown only; an unqualified
    // `"tenants"."id" ilike` is the operator-does-not-exist 500.
    const blob = whereFragments.map((f) => render(f).sql).join(' ');
    expect(blob).not.toMatch(/"tenants"\."id" ilike/i);
    expect(blob).not.toMatch(/"users"\."id" ilike/i);
  });

  it('still matches the term literally, metacharacters escaped', async () => {
    reset();
    await search('q=40%25');
    const params = whereFragments.flatMap((f) => render(f).params);
    expect(params).toContain('%40\\%%');
  });

  it('answers an empty result for a query too short to search, without touching the db', async () => {
    reset();
    const res = await search('q=a');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], results: [] });
    expect(whereFragments).toHaveLength(0);
  });

  it('answers 200 for a well-formed query', async () => {
    reset();
    const res = await search('q=siraoi');
    expect(res.status).toBe(200);
  });
});

describe('superadmin data-explorer per-tenant scoping', () => {
  it('scopes the tenants tab on the tenant primary key, not a phantom tenant_id', async () => {
    reset();
    const res = await explore(`type=tenants&tenantId=${TENANT_ID}`);
    expect(res.status).toBe(200);

    const blob = executedQueries.map((q) => render(q).sql).join(' ');
    expect(blob).toMatch(/t\.id/i);
    expect(blob).not.toMatch(/\bt\.tenant_id\b/);
    expect(blob).not.toMatch(/"t"\."tenant_id"/);
  });

  it('scopes the users tab through tenant_members, where membership actually lives', async () => {
    reset();
    const res = await explore(`type=users&tenantId=${TENANT_ID}`);
    expect(res.status).toBe(200);

    const queries = executedQueries.map((q) => render(q).sql);
    const blob = queries.join(' ');
    expect(blob).toMatch(/tm\.tenant_id/i);
    expect(blob).not.toMatch(/\bu\.tenant_id\b/);
    expect(blob).not.toMatch(/"u"\."tenant_id"/);
    // The count query needs the join too: counting distinct users against a
    // tm.* predicate without it is the `missing FROM-clause entry` 500.
    const countQuery = queries.find((sql) => /count\(distinct u\.id\)/i.test(sql));
    expect(countQuery).toBeDefined();
    expect(countQuery!).toMatch(/LEFT JOIN tenant_members tm/i);
  });

  it('keeps tenant_id scoping for the tables that really have the column', async () => {
    reset();
    const res = await explore(`type=contacts&tenantId=${TENANT_ID}`);
    expect(res.status).toBe(200);
    const blob = executedQueries.map((q) => render(q).sql).join(' ');
    expect(blob).toMatch(/"c"\."tenant_id"/);
  });

  it('survives the whole type=all page with a tenant selected', async () => {
    reset();
    const res = await explore(`type=all&tenantId=${TENANT_ID}&q=siraoi`);
    expect(res.status).toBe(200);

    const blob = executedQueries.map((q) => render(q).sql).join(' ');
    expect(blob).not.toMatch(/"t"\."tenant_id"/);
    expect(blob).not.toMatch(/"u"\."tenant_id"/);
  });

  it('escapes LIKE metacharacters in the explorer search term as well', async () => {
    reset();
    await explore(`type=deals&q=a_b`);
    const params = executedQueries.flatMap((q) => render(q).params);
    expect(params.some((p) => typeof p === 'string' && p === '%a\\_b%')).toBe(true);
  });
});
