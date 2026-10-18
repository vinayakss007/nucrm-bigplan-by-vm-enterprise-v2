/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2677 — three CSV surfaces read the whole tenant while the list beside them
 * read only the caller's own rows.
 *
 * `contacts/route.ts:58-60`, `deals/route.ts:56-58`, `tasks/route.ts:38-40` and
 * `leads/route.ts:90-92` all add `assigned_to = me OR created_by = me` when the
 * role lacks the entity's `view_all` (`lib/permissions/definitions.ts:23,34,50,58`;
 * the `sales_rep` preset at `:133-135` turns them off), and `contacts/route.ts:54`
 * plus `deals/route.ts:53` hide archived rows by default. None of the three
 * exporters — `lib/export/index.ts` (behind `GET /contacts/export`), the
 * hand-written `GET /deals/export`, and the generic `POST /export` — mentioned
 * `view_all`, `isArchived` or the deal archive flag at all. So a rep whose UI
 * shows twelve records pressed Export and downloaded up to `MAX_EXPORT_ROWS`
 * (50,000) of the workspace, and the same file carried rows the list hides.
 *
 * Asserted on the SQL drizzle renders, because a mocked `db` returns whatever it
 * is told: a canned row set would pass with no ownership predicate anywhere,
 * which is how this shipped.
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
  // Only `requireAuth` is faked: `can()`/`requirePerm()` are the rules under test.
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/queue', () => ({ addJob: vi.fn(async () => ({ id: 'job' })) }));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: (_ctx: unknown, _entity: string, rows: unknown[]) => Promise.resolve(rows),
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const { ownerScope } = await import('@/lib/api/owner-scope');
const { generateExportData } = await import('@/lib/export');
const { contacts, tasks } = await import('@/drizzle/schema');
const contactsExport = await import('@/app/api/tenant/contacts/export/route');
const dealsExport = await import('@/app/api/tenant/deals/export/route');
const genericExport = await import('@/app/api/tenant/export/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function setup(rows: unknown[] = []) {
  vi.resetModules();
  wheres = [];
  mockDb.select.mockImplementation(() => makeBuilder(rows));
}

async function call(
  mod: Record<string, unknown>,
  path: string,
  ctx: AuthContext,
  init: { method?: string; body?: unknown } = {},
) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const handler = (init.method === 'POST' ? mod.POST : mod.GET) as (req: NextRequest) => Promise<Response>;
  const url = new URL(`/api/tenant/${path}`, 'http://localhost:3000');
  return handler(new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }));
}

const ownsBoth = (table: string) => (clause: { sql: string; params: unknown[] }) =>
  new RegExp(`"${table}"\\."assigned_to".*=.*or.*"${table}"\\."created_by".*=`).test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

const REPOFF = { 'contacts.export': true, 'deals.export': true, 'settings.manage': true };
const BROAD = {
  ...REPOFF,
  'contacts.view_all': true, 'deals.view_all': true, 'tasks.view_all': true, 'leads.view_all': true,
};

describe('the shared exporter carries the caller narrowing and the list visibility (#2677)', () => {
  it('contacts rows exclude archived contacts, as every other contacts surface does', async () => {
    setup();
    await generateExportData({ tenantId: TENANT, userId: MINE, entityType: 'contacts' });
    expect(wheres[0].sql).toMatch(/"contacts"\."is_archived"/);
    expect(wheres[0].params).toContain(false);
    expect(wheres[0].sql).toMatch(/"contacts"\."deleted_at" is null/i);
  });

  it('an owner scope joins the tenant predicate instead of replacing it', async () => {
    setup();
    await generateExportData({
      tenantId: TENANT, userId: MINE, entityType: 'contacts',
      scope: ownerScope(ctxWith(REPOFF), 'contacts.view_all', contacts),
    });
    expect(ownsBoth('contacts')(wheres[0]), wheres[0].sql).toBe(true);
    expect(wheres[0].sql).toContain('"contacts"."tenant_id"');
  });

  it('a caller without an AuthContext keeps reading the tenant — the cron path is unchanged', async () => {
    setup();
    await generateExportData({ tenantId: TENANT, userId: '', entityType: 'contacts' });
    // `app/api/cron/scheduled-report-delivery` runs as a tenant-wide role and is
    // correct to; the scope must stay opt-in for it.
    expect(wheres[0].sql).not.toMatch(/"contacts"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT, false]);
  });

  it('deals rows exclude archived deals, which deals/route.ts:53 hides by default', async () => {
    setup();
    await generateExportData({ tenantId: TENANT, userId: MINE, entityType: 'deals' });
    expect(wheres[0].sql).toMatch(/metadata/i);
    expect(wheres[0].sql).toMatch(/'archived'/);
    expect(wheres[0].sql).toMatch(/coalesce/i);
  });

  it('tasks rows carry the scope when one is passed', async () => {
    setup();
    await generateExportData({
      tenantId: TENANT, userId: MINE, entityType: 'tasks',
      scope: ownerScope(ctxWith(REPOFF), 'tasks.view_all', tasks),
    });
    expect(ownsBoth('tasks')(wheres[0]), wheres[0].sql).toBe(true);
  });
});

describe('GET /contacts/export answers with the rows the caller may read (#2677)', () => {
  it('a rep without contacts.view_all exports only their own contacts', async () => {
    setup();
    const res = await call(contactsExport, 'contacts/export', ctxWith(REPOFF));
    expect(res.status).toBe(200);
    expect(wheres).toHaveLength(1);
    expect(ownsBoth('contacts')(wheres[0]), wheres[0].sql).toBe(true);
    expect(wheres[0].sql).toMatch(/"contacts"\."is_archived"/);
  });

  it('a manager with contacts.view_all still exports the workspace', async () => {
    setup();
    await call(contactsExport, 'contacts/export', ctxWith(BROAD));
    expect(wheres[0].sql).not.toMatch(/"contacts"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT, false]);
  });
});

describe('GET /deals/export answers with the rows the caller may read (#2677)', () => {
  it('a rep without deals.view_all exports only their own deals', async () => {
    setup();
    const res = await call(dealsExport, 'deals/export', ctxWith(REPOFF));
    expect(res.status).toBe(200);
    expect(ownsBoth('deals')(wheres[0]), wheres[0].sql).toBe(true);
    expect(wheres[0].sql).toMatch(/"deals"\."deleted_at" is null/i);
    expect(wheres[0].sql).toMatch(/'archived'/);
  });

  it('a manager keeps the whole pipeline without the ownership predicate', async () => {
    setup();
    await call(dealsExport, 'deals/export', ctxWith(BROAD));
    expect(wheres[0].sql).not.toMatch(/"deals"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT]);
  });
});

describe('POST /export scopes the entities whose lists scope (#2677)', () => {
  it.each([
    ['contacts', 'contacts'],
    ['deals', 'deals'],
    ['tasks', 'tasks'],
    ['leads', 'leads'],
  ])('a rep exporting %s gets only their own rows', async (entity, table) => {
    setup();
    const res = await call(genericExport, 'export', ctxWith(REPOFF), { method: 'POST', body: { entity, format: 'csv' } });
    expect(res.status).toBe(200);
    expect(ownsBoth(table)(wheres[0]), `${entity}: ${wheres[0].sql}`).toBe(true);
  });

  it('contacts through the generic handler also drops archived rows', async () => {
    setup();
    await call(genericExport, 'export', ctxWith(REPOFF), { method: 'POST', body: { entity: 'contacts', format: 'csv' } });
    expect(wheres[0].sql).toMatch(/"contacts"\."is_archived"/);
  });

  it('deals through the generic handler also drops archived deals', async () => {
    setup();
    await call(genericExport, 'export', ctxWith(REPOFF), { method: 'POST', body: { entity: 'deals', format: 'csv' } });
    expect(wheres[0].sql).toMatch(/'archived'/);
  });

  it('a view_all holder keeps the tenant-wide read on every entity', async () => {
    for (const entity of ['contacts', 'deals', 'tasks', 'leads']) {
      setup();
      await call(genericExport, 'export', ctxWith(BROAD), { method: 'POST', body: { entity, format: 'csv' } });
      expect(wheres[0].sql, entity).not.toMatch(/"created_by"/);
      // Contacts additionally always drops archived rows, which binds `false`
      // whether or not the caller is owner-scoped.
      expect(wheres[0].params, entity).toEqual(entity === 'contacts' ? [TENANT, false] : [TENANT]);
    }
  });

  it('companies stays tenant-wide — its view_all is enforced nowhere yet (#2597)', async () => {
    setup();
    await call(genericExport, 'export', ctxWith(REPOFF), { method: 'POST', body: { entity: 'companies', format: 'csv' } });
    // Scoping only the export would make it stricter than the list, which is a
    // different bug. Pinned so the next reader does not "fix" it half-way.
    expect(wheres[0].sql).not.toMatch(/"companies"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT]);
  });
});
