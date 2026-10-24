/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3212 — four soft-delete handlers stamped `deletedBy` on tables that have no
 * `deleted_by` column, and the stamp was invisible in both directions:
 *
 *   `as Record<string, unknown>` hides the phantom key from tsc, and Drizzle
 *   builds the SET clause from the table's own column map, so a key it does not
 *   declare renders as nothing. No error, no log, no column — the tombstone just
 *   looked like it recorded who deleted the row. The four sites on main:
 *
 *     - `app/api/tenant/views/[id]/route.ts`              DELETE (`saved_views`)
 *     - `app/api/tenant/lead-warming/campaigns/[id]`      DELETE (`lead_warming_campaigns`)
 *     - `app/api/tenant/tax/route.ts`                     DELETE (`tax_rates`)
 *     - `app/api/tenant/territories/route.ts`             DELETE (`territories`)
 *
 *   All four tables spread `utils.lifecycle()` (createdAt/updatedAt/deletedAt),
 *   not `utils.audit()` (which is what adds createdBy/updatedBy/deletedBy).
 *
 * The fix drops the dead key *and* the cast, so the compiler enforces the column
 * list from here on; `views/[id]` DELETE additionally gets the guarded write the
 * rest of this family already has (#3194 doctrine: the vetted fact belongs in
 * the WHERE, and the write must read back what it claims to have touched).
 *
 * What this suite asserts is not a mock call count. Each handler's `.set({...})`
 * is captured and then handed to a *real* Drizzle update builder on the *real*
 * table, and the rendered SQL must name a column for every key the handler
 * passed. That is the check with teeth: if someone re-adds `deletedBy`, the
 * captured set grows, the rendered SET clause does not, and the suite goes red —
 * which is precisely the failure mode that let this ship in the first place.
 * `main`'s own shape is kept as the poison control below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { savedViews } from '@/drizzle/schema';
import { taxRates } from '@/drizzle/schema/financial';
import { territories } from '@/drizzle/schema/territories';
import { leadWarmingCampaigns } from '@/drizzle/schema/lead-warming';
import type { AuthContext } from '@/lib/auth/middleware';

// RFC 2606 `.test` fixtures and TEST-NET-style UUIDs only — this repo is public.
const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VIEW_ID = '55555555-5555-4555-8555-555555555555';
const CAMPAIGN_ID = '66666666-6666-4666-8666-666666666666';
const TAX_ID = '77777777-7777-4777-8777-777777777777';
const TERRITORY_ID = '88888888-8888-4888-8888-888888888888';

const dialect = new PgDialect({} as never);

/**
 * A real Dialect-backed builder so the assertions below inspect Drizzle's own
 * column resolution rather than our reading of it. No connection is ever
 * attempted: `.toSQL()` renders lazily and port 1 on the loopback is a fixture,
 * not a target.
 */
const renderDb = drizzle(new Pool({
  connectionString: 'postgres://nucrm_fix:nucrm_fix@127.0.0.1:1/nucrm.test',
}));

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  /** Rows every pre-write `db.select(...).from(...).where(...).limit(1)` resolves to. */
  readRows: [] as unknown[],
  /** `.returning()` fixtures per `db.update` statement, in call order. */
  updateReturns: [] as unknown[][],
  /** Everything every `db.update` was asked to write, in call order. */
  dbUpdates: [] as Captured[],
};

function makeNode(target: Captured[], queue: () => unknown[][]): Record<string, unknown> {
  let rec: Captured = { sql: '', params: [], set: {} };
  const consume = (): unknown[] => {
    const at = target.length;
    target.push(rec);
    return queue()[at] ?? [];
  };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    where: (pred: unknown) => {
      const rendered = dialect.sqlToQuery(pred as never);
      rec = { sql: rendered.sql, params: rendered.params as unknown[], set: rec.set };
      return node;
    },
    returning: () => Promise.resolve(consume()),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(consume()).then(resolve),
  };
  return node;
}

const db: Record<string, unknown> = {
  update: () => makeNode(state.dbUpdates, () => state.updateReturns),
  select: () => {
    const builder: Record<string, unknown> = {};
    builder['from'] = () => builder;
    builder['where'] = () => builder;
    builder['limit'] = () => Promise.resolve(state.readRows);
    return builder;
  },
};

// `@/drizzle/db` is the only handle these handlers touch the pool with, and a
// mock call count cannot show a column that was never rendered.
vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  validateBody: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: async () => undefined,
  checkStaleUpdate: async () => undefined,
}));
vi.mock('@/lib/modules/gate', () => ({ requireModule: async () => undefined }));
vi.mock('@/lib/territories', () => ({ getTerritoryTree: async () => [] }));
vi.mock('@/lib/ai/plan-gate', () => ({ requireAiFeature: async () => null }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => activeCtx), can: () => true };
});
vi.mock('@/lib/api-error', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-error')>('@/lib/api-error');
  return { ...actual, apiError: vi.fn((err: unknown) => { throw err; }) };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

const adminCtx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

const nonAdminCtx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'member', permissions: {},
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

/** The identity `requireAuth` resolves for the handler under test. */
let activeCtx: AuthContext = adminCtx;

beforeEach(() => {
  vi.resetModules();
  activeCtx = adminCtx;
  state.readRows = [];
  state.updateReturns = [];
  state.dbUpdates = [];
});

/** drizzle property name -> rendered column name, for one table. */
function columnMapOf(table: unknown): Map<string, string> {
  const cols = (table as Record<symbol, Record<string, { name: string }>>)[Table.Symbol.Columns];
  const map = new Map<string, string>();
  for (const [key, col] of Object.entries(cols)) map.set(key, col.name);
  return map;
}

function renderSet(table: unknown, set: Record<string, unknown>): string {
  return (renderDb.update(table as never)
    .set(set as never)
    .toSQL().sql as string).toLowerCase();
}

/**
 * The load-bearing assertion: every key the handler handed to `.set()` must be a
 * column the table declares, *and* must survive Drizzle's own rendering. A
 * phantom key fails the first half, and the second half proves the first half is
 * backed by the real compiler rather than by this file's reading of the schema.
 */
function expectNoPhantomColumns(table: unknown, captured: Captured, label: string) {
  const map = columnMapOf(table);
  const rendered = renderSet(table, captured.set);
  const keys = Object.keys(captured.set);
  expect(keys.length, `${label}: handler wrote an empty SET`).toBeGreaterThan(0);
  for (const key of keys) {
    expect(map.has(key), `${label}: "${key}" is not a column of ${label}'s table — Drizzle renders it as nothing`).toBe(true);
    expect(rendered, `${label}: "${key}" did not survive into the rendered SET clause`).toContain(`"${map.get(key)}" =`);
  }
}

function deleteView(id: string, asCtx: AuthContext = adminCtx) {
  return runDelete('@/app/api/tenant/views/[id]/route', `/api/tenant/views/${id}`, id, asCtx);
}

function deleteCampaign(id: string, asCtx: AuthContext = adminCtx) {
  return runDelete('@/app/api/tenant/lead-warming/campaigns/[id]/route', `/api/tenant/lead-warming/campaigns/${id}`, id, asCtx);
}

async function runDelete(
  moduleSpec: string,
  path: string,
  id: string,
  asCtx: AuthContext,
): Promise<NextResponse> {
  activeCtx = asCtx;
  const { DELETE } = await import(moduleSpec);
  const req = new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest, c: unknown) => Promise<NextResponse>)(
    req, { params: Promise.resolve({ id }) },
  );
}

async function deleteTax(id: string = TAX_ID): Promise<NextResponse> {
  const { DELETE } = await import('@/app/api/tenant/tax/route');
  const req = new NextRequest(new URL(`/api/tenant/tax?id=${id}`, 'http://localhost:3000'), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest) => Promise<NextResponse>)(req);
}

async function deleteTerritory(id: string = TERRITORY_ID): Promise<NextResponse> {
  const { DELETE } = await import('@/app/api/tenant/territories/route');
  const req = new NextRequest(new URL(`/api/tenant/territories?id=${id}`, 'http://localhost:3000'), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (DELETE as (r: NextRequest) => Promise<NextResponse>)(req);
}

async function body(res: NextResponse): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>;
}

describe('#3212 — the phantom `deletedBy` is gone from all four tombstone writes', () => {
  it('views/[id] DELETE writes only columns saved_views declares', async () => {
    state.readRows = [{ id: VIEW_ID, tenantId: TENANT, userId: USER, deletedAt: null }];
    state.updateReturns = [[{ id: VIEW_ID }]];

    const res = await deleteView(VIEW_ID);
    expect(res.status).toBe(200);
    expect(state.dbUpdates).toHaveLength(1);
    expectNoPhantomColumns(savedViews, state.dbUpdates[0], 'saved_views');
  });

  it('lead-warming campaigns DELETE writes only columns lead_warming_campaigns declares', async () => {
    state.updateReturns = [[{ id: CAMPAIGN_ID }]];

    const res = await deleteCampaign(CAMPAIGN_ID);
    expect(res.status).toBe(200);
    expect(state.dbUpdates).toHaveLength(1);
    expectNoPhantomColumns(leadWarmingCampaigns, state.dbUpdates[0], 'lead_warming_campaigns');
  });

  it('tax DELETE writes only columns tax_rates declares', async () => {
    state.updateReturns = [[{ id: TAX_ID }]];

    const res = await deleteTax();
    expect(res.status).toBe(200);
    expect(state.dbUpdates).toHaveLength(1);
    expectNoPhantomColumns(taxRates, state.dbUpdates[0], 'tax_rates');
  });

  it('territories DELETE writes only columns territories declares', async () => {
    state.updateReturns = [[{ id: TERRITORY_ID }]];

    const res = await deleteTerritory();
    expect(res.status).toBe(200);
    expect(state.dbUpdates).toHaveLength(1);
    expectNoPhantomColumns(territories, state.dbUpdates[0], 'territories');
  });

  it('no handler stamps a deleter on any of the four tables', async () => {
    state.readRows = [{ id: VIEW_ID, tenantId: TENANT, userId: USER, deletedAt: null }];
    state.updateReturns = [[{ id: VIEW_ID }], [{ id: CAMPAIGN_ID }], [{ id: TAX_ID }], [{ id: TERRITORY_ID }]];

    await deleteView(VIEW_ID);
    await deleteCampaign(CAMPAIGN_ID);
    await deleteTax();
    await deleteTerritory();

    expect(state.dbUpdates).toHaveLength(4);
    for (const captured of state.dbUpdates) {
      expect(Object.keys(captured.set)).not.toContain('deletedBy');
      expect(renderSet(savedViews, captured.set)).not.toContain('deleted_by');
    }
  });

  it('the four tables genuinely have no deleted_by column — that is the defect, not a reading error', () => {
    for (const [table, label] of [
      [savedViews, 'saved_views'],
      [leadWarmingCampaigns, 'lead_warming_campaigns'],
      [taxRates, 'tax_rates'],
      [territories, 'territories'],
    ] as const) {
      const names = [...columnMapOf(table).values()];
      expect(names, `${label} grew a deleted_by column — this issue is closed by DDL, revisit #3212`).not.toContain('deleted_by');
      expect(names).toContain('deleted_at');
      expect(names).toContain('updated_at');
    }
  });
});

describe('#3212 — the check bites (controls)', () => {
  it('a re-added `deletedBy` is silently dropped by Drizzle, which is what the cross-capture catches', () => {
    const asOnMain = {
      deletedAt: new Date(), deletedBy: USER, updatedAt: new Date(),
    } as unknown as Record<string, unknown>;
    const rendered = renderSet(savedViews, asOnMain);

    // Drizzle renders the two real columns and nothing for the phantom one: no
    // error, no warning. Nothing but this assertion would ever have noticed.
    expect(rendered).toContain('"deleted_at" =');
    expect(rendered).toContain('"updated_at" =');
    expect(rendered).not.toContain('deleted_by');

    // …so the guard this suite runs would fail on it.
    expect(() => expectNoPhantomColumns(savedViews, { sql: '', params: [], set: asOnMain }, 'saved_views'))
      .toThrow(/not a column/);
  });

  it('the same phantom renders nothing on the other three tables too', () => {
    const poison = { deletedBy: USER, deletedAt: new Date() } as Record<string, unknown>;
    for (const table of [leadWarmingCampaigns, taxRates, territories]) {
      expect(renderSet(table, poison)).not.toContain('deleted_by');
    }
  });
});

describe('#3194 doctrine — views/[id] DELETE claims the row it deletes', () => {
  it('carries the tenant predicate and the tombstone guard into the WHERE', async () => {
    state.readRows = [{ id: VIEW_ID, tenantId: TENANT, userId: USER, deletedAt: null }];
    state.updateReturns = [[{ id: VIEW_ID }]];

    await deleteView(VIEW_ID);
    const where = state.dbUpdates[0].sql.toLowerCase();
    expect(where).toContain('"tenant_id" =');
    expect(where).toContain('"id" =');
    expect(where).toContain('is null');
    expect(state.dbUpdates[0].params).toContain(TENANT);
  });

  it('pins the owner for a non-admin, because RLS says nothing about which user owns the row', async () => {
    state.readRows = [{ id: VIEW_ID, tenantId: TENANT, userId: USER, deletedAt: null }];
    state.updateReturns = [[{ id: VIEW_ID }]];

    const res = await deleteView(VIEW_ID, nonAdminCtx);
    expect(res.status).toBe(200);
    expect(state.dbUpdates[0].sql.toLowerCase()).toContain('"user_id" =');
    expect(state.dbUpdates[0].params).toContain(USER);
  });

  it('leaves the owner predicate off for an admin, who may delete any view in the tenant', async () => {
    state.readRows = [{ id: VIEW_ID, tenantId: TENANT, userId: OTHER_USER, deletedAt: null }];
    state.updateReturns = [[{ id: VIEW_ID }]];

    const res = await deleteView(VIEW_ID);
    expect(res.status).toBe(200);
    expect(state.dbUpdates[0].sql.toLowerCase()).not.toContain('"user_id" =');
  });

  it('reads back: a view that vanished since the SELECT answers 404, not success', async () => {
    state.readRows = [{ id: VIEW_ID, tenantId: TENANT, userId: USER, deletedAt: null }];
    state.updateReturns = [[]];

    const res = await deleteView(VIEW_ID);
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'View not found' });
  });

  it('refuses a view that belongs to someone else before writing anything', async () => {
    state.readRows = [{ id: VIEW_ID, tenantId: TENANT, userId: OTHER_USER, deletedAt: null }];
    state.updateReturns = [[{ id: VIEW_ID }]];

    const res = await deleteView(VIEW_ID, nonAdminCtx);
    expect(res.status).toBe(403);
    expect(state.dbUpdates).toHaveLength(0);
  });

  it('a campaign that vanished since the auth check is not reported as archived', async () => {
    state.updateReturns = [[]];

    const res = await deleteCampaign(CAMPAIGN_ID);
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: 'Campaign not found' });
  });

  it('the two reads that were already in place still 404 on an empty read-back', async () => {
    state.updateReturns = [[]];
    expect((await deleteTax()).status).toBe(404);

    state.updateReturns = [[]];
    expect((await deleteTerritory()).status).toBe(404);
  });
});
