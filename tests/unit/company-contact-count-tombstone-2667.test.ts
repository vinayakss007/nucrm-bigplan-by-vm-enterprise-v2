/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2667 — the company list counted contacts that no longer exist.
 *
 * `app/api/tenant/companies/route.ts` filters tombstoned *companies* in its outer
 * `where` and had no tombstone predicate at all on the `contact_count` aggregate
 * beside it. Every other contact count in the app excludes them
 * (`companies/[id]/route.ts:28-37` and the raw subquery at `:46`,
 * `contacts/route.ts:55`, `search/route.ts:132`, both `data-explorer` routes), so
 * the list and the detail page showed different contact counts for one company and
 * nothing in the UI said which was right.
 *
 * Asserted on the SQL drizzle renders, not on mocked rows: a canned `[{count: 3}]`
 * passes with no `deleted_at` clause anywhere, which is exactly how this survived.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let selectCall = 0;
const mockDb: { select: ReturnType<typeof vi.fn> } = { select: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'groupBy', 'orderBy', 'limit', 'offset', 'as']) builder[m] = chain;
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
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: (_ctx: unknown, _entity: string, rows: unknown[]) => Promise.resolve(rows),
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
  attachStrippedFields: (res: unknown) => res,
}));

const { requireAuth } = await import('@/lib/auth/middleware');

function setup(rowsPerQuery: unknown[][]) {
  vi.resetModules();
  wheres = [];
  selectCall = 0;
  mockDb.select.mockImplementation(() => {
    const rows = rowsPerQuery[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(rows);
  });
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'user-1', tenantId: TENANT, roleSlug: 'admin',
    permissions: { 'companies.view': true }, isAdmin: true, isSuperAdmin: false,
  } as AuthContext);
}

async function get(path = '/api/tenant/companies') {
  const { GET } = await import('@/app/api/tenant/companies/route');
  return GET(new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  }));
}

const clause = (n: number) => {
  expect(wheres[n], `expected a where clause on query #${n}; saw ${wheres.length}`).toBeDefined();
  return wheres[n];
};

describe('the contact_count aggregate is tombstone-scoped (#2667)', () => {
  it('excludes deleted contacts from the count the list displays', async () => {
    setup([[], [{ contactCount: 0 }], [{ count: 0 }]]);
    const res = await get();
    expect(res.status, await res.text()).toBe(200);

    // Query #0 is the subquery built off `contacts` — the one that was missing.
    const count = clause(0);
    expect(count.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(count.sql).toContain('"contacts"."tenant_id"');
    // `IS NULL` binds nothing, so an extra parameter means the tombstone test
    // drifted into a comparison and would silently match every row.
    expect(count.params).toEqual([TENANT]);
  });

  it('still excludes deleted companies from the rows beside that count', async () => {
    setup([[], [], []]);
    await get();
    const list = clause(1);
    expect(list.sql).toMatch(/"companies"\."deleted_at" is null/i);
    expect(list.sql).not.toMatch(/"contacts"\."deleted_at"/);
  });

  it('keeps the tombstone test when a search narrows the list', async () => {
    setup([[], [], []]);
    await get('/api/tenant/companies?q=acme&industry=SaaS');
    expect(clause(0).sql).toMatch(/"contacts"\."deleted_at" is null/i);
    // The filters belong to the list query, not to the per-company count: a
    // company in another industry still needs its own live contact total.
    expect(clause(0).sql).not.toMatch(/ilike/i);
    expect(clause(1).params).toEqual([TENANT, '%acme%', 'SaaS']);
  });

  it('the count subquery stays a contacts aggregate, not a companies one', async () => {
    setup([[], [], []]);
    await get();
    expect(clause(0).sql).toContain('"contacts"');
    expect(clause(0).sql).not.toContain('"companies".deleted_at');
  });
});
