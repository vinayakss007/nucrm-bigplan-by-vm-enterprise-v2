/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2668 — the companies CSV read deleted companies.
 *
 * `app/api/tenant/companies/export/route.ts` selected every row in the tenant with
 * no `deletedAt` predicate, while `companies/route.ts:40-43` (the list the export
 * button sits above) filtered them. So the download was a strict superset of what
 * the customer could see, its row count matched nothing on screen, and a trashed
 * company came back in the file with its website, phone, annual revenue and notes.
 *
 * #2291 fixed the identical defect for deals — `deals/export/route.ts:41-43` still
 * carries the comment saying so — and the generic engine in `lib/export/index.ts:190`
 * already filtered tombstones. Companies were the outlier among the exports.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
const mockDb: { select: ReturnType<typeof vi.fn> } = { select: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'orderBy', 'limit', 'offset']) builder[m] = chain;
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
}));

const { requireAuth } = await import('@/lib/auth/middleware');

function setup(rows: unknown[]) {
  vi.resetModules();
  wheres = [];
  mockDb.select.mockReturnValue(makeBuilder(rows));
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'user-1', tenantId: TENANT, roleSlug: 'admin',
    permissions: { 'companies.export': true }, isAdmin: true, isSuperAdmin: false,
  } as AuthContext);
}

async function get() {
  const { GET } = await import('@/app/api/tenant/companies/export/route');
  return GET(new NextRequest(new URL('/api/tenant/companies/export', 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  }));
}

const LIVE_ROW = {
  name: 'Acme', domain: 'acme.test', industry: 'SaaS', phone: '+91', address: '', city: 'Pune',
  state: 'MH', country: 'IN', postalCode: '', numberOfEmployees: 10, annualRevenue: '1000',
  notes: '', tags: [], createdAt: new Date('2026-01-02T03:04:05Z'),
};

describe('the companies CSV excludes tombstones (#2668)', () => {
  it('filters companies.deletedAt on the SQL drizzle actually renders', async () => {
    setup([LIVE_ROW]);
    const res = await get();
    expect(res.status, await res.text()).toBe(200);

    // One query, one predicate — the tombstone test belongs to the read itself,
    // not to the projection that follows it.
    expect(wheres).toHaveLength(1);
    expect(wheres[0].sql).toMatch(/"companies"\."deleted_at" is null/i);
    expect(wheres[0].sql).toContain('"companies"."tenant_id"');
    // `IS NULL` binds nothing: an extra parameter means the test drifted into a
    // comparison, which would match no rows at all instead of the deleted ones.
    expect(wheres[0].params).toEqual([TENANT]);
  });

  it('still writes a CSV of the rows it did read', async () => {
    setup([LIVE_ROW]);
    const res = await get();
    expect(res.headers.get('content-type')).toContain('text/csv');
    const body = await res.text();
    expect(body.split('\n')[0]).toBe('name,domain,industry,phone,address,city,state,country,postal_code,company_size,annual_revenue,notes,tags,created_at');
    expect(body).toContain('Acme');
  });

  it('an empty result is an empty file, not a failure', async () => {
    setup([]);
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.text()).split('\n')).toHaveLength(1);
  });

  it('a restricted column is still dropped from the header and every row', async () => {
    // #2618's projection has to keep working with the new predicate in place:
    // the export may not turn a hidden column into an unnamed trailing cell.
    setup([{ ...LIVE_ROW }, { name: 'Beta' } as unknown as typeof LIVE_ROW]);
    const res = await get();
    expect(res.status).toBe(200);
    const [header] = (await res.text()).split('\n');
    // The second row is missing every column but `name`, so only `name` survives
    // the `key in r` screen on all rows.
    expect(header).toBe('name');
  });
});
