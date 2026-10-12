/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2236 — soft-deleted services/orders/contracts/reports must not surface in
 * list GETs, picker dropdowns, exports or pagination totals.
 *
 * The fake db below behaves like Postgres for the one predicate under test:
 * it renders the captured WHERE fragment with PgDialect and keeps/excludes
 * rows based on the `deleted_at IS NULL` / `IS NOT NULL` clause. That proves
 * the fix at the response level (a tombstone really disappears from the
 * JSON) instead of only pinning the SQL text.
 *
 * The last block pins the opposite convention on the intentional trash/
 * restore listing (/api/tenant/trash): soft-deleted rows must STILL be
 * visible there, so the new isNull() filters cannot leak into recovery paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SQL } from 'drizzle-orm';

const TENANT = 'a1111111-1111-4111-8111-111111111111';

const harness = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Record<string, unknown>[]>,
    whereSqls: [] as string[],
  };
  // Populated after imports resolve (vi.hoisted factories cannot import).
  const inject = { render: null as null | ((f: SQL) => string) };

  const makeChain = (cols?: Record<string, unknown>) => {
    let captured: SQL | null = null;
    let limitN: number | undefined;
    let offsetN = 0;
    const chain: Record<string, unknown> = {};
    const finalize = async () => {
      let rows: Record<string, unknown>[] = [];
      if (captured && inject.render) {
        const sqlText = inject.render(captured);
        state.whereSqls.push(sqlText);
        const tableMatch = /"([a-z_]+)"\./.exec(sqlText);
        rows = state.tables[tableMatch?.[1] ?? ''] ?? [];
        // Routes use both isNull() and raw sql`... IS NULL` (#2236) — match either case.
        if (/"deleted_at" is not null/i.test(sqlText)) rows = rows.filter(r => r.deletedAt != null);
        else if (/"deleted_at" is null/i.test(sqlText)) rows = rows.filter(r => r.deletedAt == null);
      }
      rows = rows.slice(offsetN, limitN === undefined ? undefined : offsetN + limitN);
      if (cols && 'count' in cols) return [{ count: rows.length }];
      return rows.map(r => ({ ...r }));
    };
    chain.from = () => chain;
    chain.leftJoin = () => chain;
    chain.rightJoin = () => chain;
    chain.innerJoin = () => chain;
    chain.orderBy = () => chain;
    chain.groupBy = () => chain;
    chain.where = (f: SQL) => { captured = f; return chain; };
    chain.limit = (n: number) => { limitN = n; return chain; };
    chain.offset = (n: number) => { offsetN = n; return chain; };
    chain.returning = () => chain;
    chain.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      finalize().then(ok, err);
    return chain;
  };

  const db = {
    select: (cols?: Record<string, unknown>) => makeChain(cols),
  };
  return { state, inject, db };
});

vi.mock('@/drizzle/db', () => ({ db: harness.db }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({
    tenantId: TENANT,
    userId: 'user-1',
    isAdmin: true,
    isSuperAdmin: false,
    user: { email: 'admin@example.com' },
  })),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/tenant/context', () => ({
  requireTenantCtx: vi.fn(async () => ({ tenantId: TENANT, userId: 'user-1' })),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/read-rate-limit', () => ({ rateLimitRead: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/pdf/render', () => ({
  renderContractPdf: vi.fn(async () => Buffer.from('%PDF-FAKE')),
}));

import { PgDialect } from 'drizzle-orm/pg-core';
import * as servicesRoute from '@/app/api/tenant/services/route';
import * as ordersRoute from '@/app/api/tenant/orders/route';
import * as contractsRoute from '@/app/api/tenant/contracts/route';
import * as analyticsScheduledRoute from '@/app/api/tenant/analytics/scheduled-reports/route';
import * as reportsScheduledRoute from '@/app/api/tenant/reports/scheduled/route';
import * as contractPdfRoute from '@/app/api/tenant/contracts/[id]/pdf/route';
import * as trashRoute from '@/app/api/tenant/trash/route';

const dialect = new PgDialect();
harness.inject.render = (f: SQL) => dialect.sqlToQuery(f).sql;

const ACTIVE_SVC = { id: 'svc-active', tenantId: TENANT, name: 'Active Service', isActive: true, deletedAt: null };
const DELETED_SVC = { id: 'svc-deleted', tenantId: TENANT, name: 'Deleted Service', isActive: true, deletedAt: new Date() };
const ACTIVE_ORDER = { id: 'ord-active', tenantId: TENANT, status: 'pending', deletedAt: null };
const DELETED_ORDER = { id: 'ord-deleted', tenantId: TENANT, status: 'pending', deletedAt: new Date() };
const ACTIVE_CONTRACT = { id: 'con-active', tenantId: TENANT, title: 'Active', status: 'active', startDate: new Date(), contractNumber: 'C-1', deletedAt: null };
const DELETED_CONTRACT = { id: 'con-deleted', tenantId: TENANT, title: 'Deleted', status: 'active', startDate: new Date(), contractNumber: 'C-2', deletedAt: new Date() };
const ACTIVE_SCHEDULE = { id: 'sch-active', tenantId: TENANT, name: 'Weekly', deletedAt: null };
const DELETED_SCHEDULE = { id: 'sch-deleted', tenantId: TENANT, name: 'Stale', deletedAt: new Date() };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test shim: withApiRoute widens the handler signature (Promise<Response | void | undefined>) and each route has its own context type
async function getJson(url: string, route: { GET: (...args: any[]) => Promise<any> }): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await route.GET(new Request(url) as NextRequest) as Response;
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.state.tables = {
    services: [ACTIVE_SVC, DELETED_SVC],
    orders: [ACTIVE_ORDER, DELETED_ORDER],
    contracts: [ACTIVE_CONTRACT, DELETED_CONTRACT],
    scheduled_reports: [ACTIVE_SCHEDULE, DELETED_SCHEDULE],
    tenants: [{ id: TENANT, name: 'Acme' }],
    contacts: [
      { id: 'contact-active', tenantId: TENANT, deletedAt: null },
      { id: 'contact-gone', tenantId: TENANT, deletedAt: new Date(), deleted_at: new Date(), name: 'Gone', email: 'gone@example.com' },
    ],
  };
  harness.state.whereSqls = [];
});

describe('services list/picker GET (#2236)', () => {
  it('excludes the soft-deleted service from the list envelope', async () => {
    const { res, body } = await getJson(`http://localhost/api/tenant/services`, servicesRoute);
    expect(res.status).toBe(200);
    const ids = (body.data as Record<string, unknown>[]).map(r => r.id);
    expect(ids).toEqual(['svc-active']);
    expect((body.services as Record<string, unknown>[]).map(r => r.id)).toEqual(['svc-active']);
    expect(harness.state.whereSqls[0]).toContain('"services"."deleted_at" is null');
  });

  it('keeps excluding tombstones when called like the service picker (?category/?search)', async () => {
    const { res, body } = await getJson(
      `http://localhost/api/tenant/services?limit=200&search=Active&category=core`,
      servicesRoute,
    );
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>[]).map(r => r.id)).toEqual(['svc-active']);
  });
});

describe('orders list GET (#2236)', () => {
  it('excludes deleted orders from the page AND from the pagination total', async () => {
    const { res, body } = await getJson(`http://localhost/api/tenant/orders?page=1&limit=20`, ordersRoute);
    expect(res.status).toBe(200);
    expect((body.orders as Record<string, unknown>[]).map(r => r.id)).toEqual(['ord-active']);
    expect(body.total).toBe(1);
    expect(body.totalPages).toBe(1);
    // both the paged query and the count query carry the predicate
    expect(harness.state.whereSqls).toHaveLength(2);
    for (const sqlText of harness.state.whereSqls) {
      expect(sqlText).toContain('"orders"."deleted_at" is null');
    }
  });
});

describe('contracts list GET (#2236)', () => {
  it('excludes deleted contracts from the page AND from the pagination total', async () => {
    const { res, body } = await getJson(`http://localhost/api/tenant/contracts?page=1&limit=20`, contractsRoute);
    expect(res.status).toBe(200);
    expect((body.contracts as Record<string, unknown>[]).map(r => r.id)).toEqual(['con-active']);
    expect(body.total).toBe(1);
    expect(harness.state.whereSqls).toHaveLength(2);
    for (const sqlText of harness.state.whereSqls) {
      expect(sqlText).toContain('"contracts"."deleted_at" is null');
    }
  });
});

describe('scheduled reports list GETs (#2236)', () => {
  it('tenant/analytics/scheduled-reports excludes the tombstone', async () => {
    const { res, body } = await getJson(
      `http://localhost/api/tenant/analytics/scheduled-reports`,
      analyticsScheduledRoute,
    );
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>[]).map(r => r.id)).toEqual(['sch-active']);
    expect(harness.state.whereSqls[0]).toContain('"scheduled_reports"."deleted_at" is null');
  });

  it('tenant/reports/scheduled (already filtered before this fix) stays filtered', async () => {
    const { res, body } = await getJson(
      `http://localhost/api/tenant/reports/scheduled`,
      reportsScheduledRoute,
    );
    expect(res.status).toBe(200);
    expect((body.data as Record<string, unknown>[]).map(r => r.id)).toEqual(['sch-active']);
  });
});

describe('contract PDF export (#2236)', () => {
  // The fake db only evaluates the deleted_at predicate (not eq(id)), so each
  // case plants exactly the row the route is looking for.
  it('serves the PDF for a live contract', async () => {
    harness.state.tables.contracts = [ACTIVE_CONTRACT];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapped handler context type is void|Response|undefined
    const res = await (contractPdfRoute.GET as any)(
      new Request(`http://localhost/api/tenant/contracts/con-active/pdf`) as NextRequest,
      { params: Promise.resolve({ id: 'con-active' }) },
    ) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('404s for a soft-deleted contract instead of exporting it', async () => {
    harness.state.tables.contracts = [DELETED_CONTRACT];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wrapped handler context type is void|Response|undefined
    const res = await (contractPdfRoute.GET as any)(
      new Request(`http://localhost/api/tenant/contracts/con-deleted/pdf`) as NextRequest,
      { params: Promise.resolve({ id: 'con-deleted' }) },
    ) as Response;
    expect(res.status).toBe(404);
    expect(harness.state.whereSqls[0]).toMatch(/"contracts"\."deleted_at" is null/i);
  });
});

describe('intentional trash/restore listing keeps showing deleted rows', () => {
  it('/api/tenant/trash still lists the soft-deleted contact (is NOT NULL, not isNull)', async () => {
    const { res, body } = await getJson(
      `http://localhost/api/tenant/trash?type=contact`,
      trashRoute,
    );
    expect(res.status).toBe(200);
    const ids = (body.data as Record<string, unknown>[]).map(r => r.id);
    expect(ids).toContain('contact-gone');
    expect(ids).not.toContain('contact-active');
    expect(harness.state.whereSqls[0]).toContain('"contacts"."deleted_at" is not null');
  });
});
