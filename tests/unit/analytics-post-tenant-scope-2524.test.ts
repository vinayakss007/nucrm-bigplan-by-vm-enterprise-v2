/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2524 — the two analytics `calculate` POSTs took an entity id straight out of
 * the request body and used it twice without ever asking whose it was: once as
 * the argument of a `public.calculate_*` RPC, once as the only predicate of a
 * read on `deal_forecasts` / `churn_predictions`. The sibling `GET` in each file
 * is tenant-scoped, and the correct sibling route
 * (`app/api/tenant/deals/[id]/forecast/route.ts`) proves the id against
 * `deals.tenant_id` first — so these two were the outlier, not a design.
 *
 * These tests pin three things, in order of how much they hurt if they drift:
 *   1. a foreign id answers 404 and the RPC is never invoked (the leak itself);
 *   2. the tenant id is actually bound into BOTH where clauses, asserted on the
 *      rendered SQL rather than on a mocked return value, because a mocked db
 *      returns whatever it is told and would pass with no filter at all;
 *   3. `calculateSchema` keeps #2286's lenient shape rule — seeded ids carry
 *      version-0 nibbles, and a strict `.uuid()` would reject ids the GET hands out.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const DEAL_A = '33333333-3333-4333-8333-333333333333';
const CONTACT_A = '44444444-4444-4444-8444-444444444444';
/** Seeded pipeline-style id: version nibble 0, which zod's `.uuid()` rejects. */
const SEEDED_ID = '50000000-0000-0000-0000-000000000001';

const mockRequireAuth = vi.fn();
const mockCan = vi.fn().mockReturnValue(true);
const mockDb = {
  select: vi.fn(),
  execute: vi.fn().mockResolvedValue({ rows: [{ probability: 0.42 }] }),
};

// Each `.select().from().where()` chain is rendered to real Postgres SQL through
// drizzle's own dialect, in call order, so a test can name the exact
// table-qualified column and every bound parameter. A mocked db returns whatever
// it is told, so asserting on a canned row would pass with no filter at all;
// asserting on the rendered predicate is what actually pins #2524.
const dialect = new PgDialect({} as never);
let selectResults: unknown[][] = [];
let selectCall = 0;
let whereClauses: { sql: string; params: unknown[] }[] = [];

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'orderBy', 'limit']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    whereClauses.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: mockRequireAuth, can: mockCan };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

function ctx(tenantId = TENANT_A): AuthContext {
  return {
    userId: 'user-a-001',
    tenantId,
    roleSlug: 'admin',
    permissions: { 'deals.edit': true, 'contacts.edit': true },
    isAdmin: true,
    isSuperAdmin: false,
  } as AuthContext;
}

function postReq(path: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
}

function setup(rowsForTenantLookup: unknown[], authTenant = TENANT_A) {
  vi.resetModules();
  whereClauses = [];
  selectCall = 0;
  selectResults = [rowsForTenantLookup, [{ id: 'forecast-row-1', tenantId: authTenant }]];
  mockDb.select.mockImplementation(() => {
    const rows = selectResults[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(rows);
  });
  mockDb.execute.mockClear().mockResolvedValue({ rows: [{ probability: 0.42 }] });
  mockRequireAuth.mockResolvedValue(ctx(authTenant));
  mockCan.mockReturnValue(true);
}

const clause = (n: number) => {
  expect(whereClauses[n], `expected a where clause on query #${n}`).toBeDefined();
  return whereClauses[n];
};

describe('POST /api/tenant/analytics/forecast — deal id is proven in-tenant (#2524)', () => {
  it('answers 404 for a foreign deal id and never reaches the RPC', async () => {
    // The attack this issue is about: authenticated as TENANT_B, holding
    // `deals.edit`, supplying tenant A's deal uuid. The probe legitimately finds
    // nothing, so nothing downstream may run.
    setup([], TENANT_B);
    const { POST } = await import('@/app/api/tenant/analytics/forecast/route');
    const res = await POST(postReq('/api/tenant/analytics/forecast', { deal_id: DEAL_A }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Deal not found' });
    expect(mockDb.execute).not.toHaveBeenCalled();
    // The forecast table must not be queried either — that read was the leak.
    expect(selectCall).toBe(1);
  });

  it('binds the caller tenant into the ownership probe and the forecast read', async () => {
    setup([{ id: DEAL_A }]);
    const { POST } = await import('@/app/api/tenant/analytics/forecast/route');
    const res = await POST(postReq('/api/tenant/analytics/forecast', { deal_id: DEAL_A }));

    expect(res.status).toBe(200);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);

    const ownership = clause(0);
    expect(ownership.sql).toContain('"deals"."id"');
    expect(ownership.sql).toContain('"deals"."tenant_id"');
    expect(ownership.sql).toContain('"deals"."deleted_at" IS NULL');
    expect(ownership.params).toEqual([DEAL_A, TENANT_A]);

    const forecastRead = clause(1);
    expect(forecastRead.sql).toContain('"deal_forecasts"."deal_id"');
    expect(forecastRead.sql).toContain('"deal_forecasts"."tenant_id"');
    // Pre-fix this clause was `("deal_forecasts"."deal_id" = $1)` — one param, no tenant.
    expect(forecastRead.params).toEqual([DEAL_A, TENANT_A]);
  });

  it('accepts a seeded non-RFC id instead of 400-ing it (#2286 leniency)', async () => {
    setup([{ id: SEEDED_ID }]);
    const { POST } = await import('@/app/api/tenant/analytics/forecast/route');
    const res = await POST(postReq('/api/tenant/analytics/forecast', { deal_id: SEEDED_ID }));

    expect(res.status).toBe(200);
    expect(clause(0).params).toContain(SEEDED_ID);
  });

  it('rejects a malformed id with 400 before any query runs', async () => {
    setup([]);
    const { POST } = await import('@/app/api/tenant/analytics/forecast/route');
    const res = await POST(postReq('/api/tenant/analytics/forecast', { deal_id: '1) or 1=1 --' }));

    expect(res.status).toBe(400);
    expect(selectCall).toBe(0);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('rejects a missing id with 400 rather than an unscoped read', async () => {
    setup([]);
    const { POST } = await import('@/app/api/tenant/analytics/forecast/route');
    const res = await POST(postReq('/api/tenant/analytics/forecast', {}));

    expect(res.status).toBe(400);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});

describe('POST /api/tenant/analytics/churn — contact id is proven in-tenant (#2524)', () => {
  it('answers 404 for a foreign contact id and never reaches the RPC', async () => {
    setup([], TENANT_B);
    const { POST } = await import('@/app/api/tenant/analytics/churn/route');
    const res = await POST(postReq('/api/tenant/analytics/churn', { contact_id: CONTACT_A }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Contact not found' });
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(selectCall).toBe(1);
  });

  it('binds the caller tenant into the ownership probe and the prediction read', async () => {
    setup([{ id: CONTACT_A }]);
    const { POST } = await import('@/app/api/tenant/analytics/churn/route');
    const res = await POST(postReq('/api/tenant/analytics/churn', { contact_id: CONTACT_A }));

    expect(res.status).toBe(200);
    expect(mockDb.execute).toHaveBeenCalledTimes(1);

    const ownership = clause(0);
    expect(ownership.sql).toContain('"contacts"."id"');
    expect(ownership.sql).toContain('"contacts"."tenant_id"');
    expect(ownership.params).toEqual([CONTACT_A, TENANT_A]);

    const predictionRead = clause(1);
    expect(predictionRead.sql).toContain('"churn_predictions"."contact_id"');
    expect(predictionRead.sql).toContain('"churn_predictions"."tenant_id"');
    // Pre-fix: `("churn_predictions"."contact_id" = $1)` — one param, no tenant.
    expect(predictionRead.params).toEqual([CONTACT_A, TENANT_A]);
  });

  it('rejects a malformed id with 400 before any query runs', async () => {
    setup([]);
    const { POST } = await import('@/app/api/tenant/analytics/churn/route');
    const res = await POST(postReq('/api/tenant/analytics/churn', { contact_id: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    expect(selectCall).toBe(0);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });
});
