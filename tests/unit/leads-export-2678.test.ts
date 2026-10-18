/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2678 — the leads page's Export button downloaded the contact book.
 *
 * `components/tenant/leads-client.tsx:242` fetched `/api/tenant/contacts/export`
 * and renamed the blob `leads_<date>.csv`. There was no leads branch to reach:
 * `ExportEntityType` (`lib/export/index.ts:19`) listed four entities and
 * `generateExportData` threw on anything else (`:259-261`). So the download was
 * the tenant's contacts — under lead filenames, with both query params dead
 * (`lead_status` is not a key the contacts branch reads; `q` matched contact
 * names), and with the contacts branch's `is_archived` filter applied to a lead
 * page whose lifecycle the flag does not describe.
 *
 * Asserted on the SQL drizzle renders, and on the header row the CSV falls back
 * to when there are no rows. A mocked `db` returns whatever it is told, so a
 * canned row set would pass while still selecting from `contacts` — which is the
 * exact shape of this bug: the response was a well-formed CSV of the wrong table.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let rowsPerCall: unknown[] = [];
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
const enforceFieldRead = vi.fn((_ctx: unknown, _entity: string, rows: unknown[]) => Promise.resolve(rows));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: (...args: unknown[]) => enforceFieldRead(...args),
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const { ownerScope } = await import('@/lib/api/owner-scope');
const { generateExportData, MAX_EXPORT_ROWS } = await import('@/lib/export');
const { leads } = await import('@/drizzle/schema');
const leadsExport = await import('@/app/api/tenant/leads/export/route');
const contactsExport = await import('@/app/api/tenant/contacts/export/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function setup(rows: unknown[] = []) {
  vi.resetModules();
  wheres = [];
  rowsPerCall = rows;
  enforceFieldRead.mockClear();
  mockDb.select.mockImplementation(() => makeBuilder(rowsPerCall));
}

async function get(path: string, ctx: AuthContext, query = '') {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const handler = leadsExport.GET as (req: NextRequest) => Promise<Response>;
  return handler(new NextRequest(new URL(`/api/tenant/${path}${query}`, 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
  }));
}

const REPOFF = { 'leads.export': true, 'contacts.export': true };
const BROAD = { ...REPOFF, 'leads.view_all': true };

const LEAD_COLUMNS = [
  'first_name', 'last_name', 'full_name', 'email', 'phone', 'title', 'company_name',
  'lead_status', 'lead_source', 'score', 'value', 'lifecycle_stage', 'authority_level',
  'city', 'country', 'tags', 'created_date',
];

describe('the exporter reads the leads table (#2678)', () => {
  it('a leads export selects from leads, not from contacts', async () => {
    setup();
    await generateExportData({ tenantId: TENANT, userId: MINE, entityType: 'leads' });
    expect(wheres[0].sql).toContain('"leads"');
    expect(wheres[0].sql).not.toMatch(/"contacts"/);
    expect(wheres[0].sql).toContain('"leads"."tenant_id"');
    expect(wheres[0].params).toContain(TENANT);
  });

  it('it excludes deleted leads and nothing else', async () => {
    setup();
    await generateExportData({ tenantId: TENANT, userId: MINE, entityType: 'leads' });
    expect(wheres[0].sql).toMatch(/"leads"\."deleted_at" is null/i);
    // Leads have no archive flag; the contacts branch this replaced filtered on
    // `is_archived`, which silently dropped half the page's rows.
    expect(wheres[0].sql).not.toMatch(/is_archived/);
  });

  it('lead_status narrows the export the way the page filters it', async () => {
    setup();
    await generateExportData({
      tenantId: TENANT, userId: MINE, entityType: 'leads',
      filters: { lead_status: 'new' },
    });
    expect(wheres[0].sql).toMatch(/"leads"\."lead_status"/);
    expect(wheres[0].params).toContain('new');
  });

  it('q searches the five columns the leads list searches', async () => {
    setup();
    await generateExportData({
      tenantId: TENANT, userId: MINE, entityType: 'leads', filters: { q: 'acme' },
    });
    for (const column of ['first_name', 'last_name', 'email', 'phone', 'company_name']) {
      expect(wheres[0].sql, column).toContain(`"leads"."${column}" ilike`);
    }
    // Bound as a parameter, wildcard-wrapped — not interpolated (`app/api/tenant/leads/route.ts:119-128`).
    expect(wheres[0].params).toContain('%acme%');
    expect(wheres[0].sql).not.toContain('acme');
  });

  it('the empty export is headed with lead columns', async () => {
    // No rows: `data[0]` cannot supply the header, so the fallback list is the
    // only thing separating a correct file from a contacts-shaped one.
    setup([]);
    const csv = await generateExportData({ tenantId: TENANT, userId: MINE, entityType: 'leads' });
    expect(csv.split(',')).toEqual(LEAD_COLUMNS);
    expect(csv).not.toContain('linkedin_url');
    expect(csv).not.toContain('notes');
  });

  it('rows are emitted under those same columns', async () => {
    const row = Object.fromEntries(LEAD_COLUMNS.map((k) => [k, k === 'score' ? 42 : 'x']));
    setup([row]);
    const csv = await generateExportData({ tenantId: TENANT, userId: MINE, entityType: 'leads' });
    expect(csv.split('\n')[0].split(',')).toEqual(LEAD_COLUMNS);
    expect(csv.split('\n')).toHaveLength(2);
  });

  it('an owner scope narrows the read instead of replacing the tenant one', async () => {
    setup();
    await generateExportData({
      tenantId: TENANT, userId: MINE, entityType: 'leads',
      scope: ownerScope(ctxWith(REPOFF), 'leads.view_all', leads),
    });
    expect(wheres[0].sql).toMatch(/"leads"\."assigned_to".*=.*or.*"leads"\."created_by".*=/);
    expect(wheres[0].params.filter(p => p === MINE)).toHaveLength(2);
    expect(wheres[0].sql).toContain('"leads"."tenant_id"');
  });
});

describe('GET /api/tenant/leads/export (#2678)', () => {
  it('refuses a caller without leads.export', async () => {
    setup();
    const res = await get('leads/export', ctxWith({ 'contacts.export': true }));
    expect(res.status).toBe(403);
    expect(wheres).toHaveLength(0);
  });

  it('answers with a lead-shaped CSV named for leads', async () => {
    setup([]);
    const res = await get('leads/export', ctxWith(BROAD), '?lead_status=new&q=acme');
    const body = await res.text();
    expect(res.status, body).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
    expect(res.headers.get('Content-Disposition')).toMatch(/filename="leads_\d{4}-\d{2}-\d{2}\.csv"/);
    expect(body.split(',')).toEqual(LEAD_COLUMNS);
    // Both params reach the query: this is what the contacts endpoint dropped.
    expect(wheres[0].params).toContain('new');
    expect(wheres[0].params).toContain('%acme%');
  });

  it('a rep without leads.view_all exports only their own leads', async () => {
    setup([]);
    const res = await get('leads/export', ctxWith(REPOFF));
    expect(res.status, await res.text()).toBe(200);
    expect(wheres[0].sql).toMatch(/"leads"\."assigned_to".*=.*or.*"leads"\."created_by".*=/);
    expect(wheres[0].params.filter(p => p === MINE)).toHaveLength(2);
  });

  it('a view_all holder keeps the tenant-wide read', async () => {
    setup([]);
    await get('leads/export', ctxWith(BROAD));
    expect(wheres[0].sql).not.toMatch(/"leads"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT]);
  });

  it('projects the rows through field_permissions for leads', async () => {
    // A row set, not an empty one: the header-only shortcut returns before
    // `opts.project` runs, so the empty case would prove nothing here.
    setup([{ email: 'a@b.c' }]);
    await get('leads/export', ctxWith(BROAD));
    expect(enforceFieldRead).toHaveBeenCalledTimes(1);
    expect(enforceFieldRead.mock.calls[0][1]).toBe('leads');
  });

  it('returns 413, not 500, when the export is over the row cap', async () => {
    setup(Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ({ email: 'a@b.c' })));
    const res = await get('leads/export', ctxWith(BROAD));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining(String(MAX_EXPORT_ROWS)) });
  });
});

describe('the leads page reaches the endpoint that matches its table (#2678)', () => {
  const client = readFileSync('components/tenant/leads-client.tsx', 'utf8');

  it('the Export button fetches /api/tenant/leads/export', () => {
    expect(client).toContain("fetch('/api/tenant/leads/export?' + q)");
  });

  it('and no longer borrows the contacts export', () => {
    expect(client).not.toContain('/api/tenant/contacts/export');
  });
});

describe('the contacts export is untouched by adding a leads branch (#2678)', () => {
  it('contacts still exports contacts, with its own archive filter', async () => {
    setup([]);
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(BROAD));
    const res = await (contactsExport.GET as (req: NextRequest) => Promise<Response>)(
      new NextRequest(new URL('/api/tenant/contacts/export', 'http://localhost:3000'), {
        method: 'GET',
        headers: { 'x-forwarded-for': '127.0.0.1' },
      }),
    );
    expect(res.status, await res.text()).toBe(200);
    expect(wheres[0].sql).toContain('"contacts"."tenant_id"');
    expect(wheres[0].sql).toMatch(/"contacts"\."is_archived"/);
    expect(wheres[0].sql).not.toMatch(/"leads"/);
  });
});
