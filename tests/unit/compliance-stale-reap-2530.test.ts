/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2530 (items 3 & 4) — the compliance POST routes stamp `processing`,
 * run the job inline, then stamp `completed`/`failed`. A hard interruption
 * (connection drop, OOM — not a JS throw, which the routes' catch already
 * handles) left the row at `processing` forever, so a GDPR erasure whose
 * data was half-anonymised still read as "underway". The routes fix this by
 * reaping stale `processing` rows on the read path
 * (lib/compliance/stale-requests.ts), which a single wrapped transaction
 * could not do without holding locks across the whole multi-table job.
 *
 * Pinned here, on rendered SQL rather than canned returns:
 *   1. the reap predicate is tenant-scoped, type-scoped, `status =
 *      'processing'`, and strictly older than the 15-minute cutoff;
 *   2. both GETs run the reap BEFORE their listing select, with their own
 *      request types only;
 *   3. the reaped row lands on the terminal state the UI already renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const STALE_MS = 15 * 60 * 1000;

const dialect = new PgDialect({} as never);

type Call = { table: string; kind: 'update' | 'select' };
let calls: Call[] = [];
let setPayloads: Record<string, unknown>[] = [];
let whereClauses: { sql: string; params: unknown[] }[] = [];
let returningRequested = false;

function chainBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'orderBy', 'limit']) builder[m] = chain;
  builder['set'] = (payload: Record<string, unknown>) => {
    setPayloads.push(payload);
    return builder;
  };
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    whereClauses.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['returning'] = () => {
    returningRequested = true;
    return Promise.resolve([]);
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve([]);
  return builder;
}

const mockDb = {
  update: vi.fn(() => {
    calls.push({ table: 'compliance_requests', kind: 'update' });
    return chainBuilder();
  }),
  select: vi.fn(() => {
    calls.push({ table: 'compliance_requests', kind: 'select' });
    return chainBuilder();
  }),
};

const mockRequireAuth = vi.fn();

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: mockRequireAuth };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/modules/gate', () => ({ requireModule: vi.fn(async () => null) }));
vi.mock('@/lib/compliance/gdpr', () => ({
  exportTenantData: vi.fn(async () => ({ metadata: {} })),
  anonymizeTenantData: vi.fn(async () => ({ anonymizedRecords: 0, categories: {} })),
}));
vi.mock('@/lib/compliance/soc2', () => ({ generateSOC2Report: vi.fn(async () => ({})) }));

beforeEach(() => {
  calls = [];
  setPayloads = [];
  whereClauses = [];
  returningRequested = false;
  mockRequireAuth.mockResolvedValue({
    userId: 'user-a-001',
    tenantId: TENANT_A,
    roleSlug: 'admin',
    permissions: {},
    isAdmin: true,
    isSuperAdmin: false,
  } satisfies AuthContext as AuthContext);
});

function getReq(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

function cutoffParam(): Date {
  const clause = whereClauses[0];
  expect(clause, 'expected the reap to render a where clause').toBeDefined();
  // drizzle binds a withTimezone timestamp as its ISO string, not a Date
  const param = clause.params.find(
    (p) => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(p),
  );
  expect(param, 'expected an ISO cutoff bound in the reap predicate').toBeTypeOf('string');
  return new Date(param as string);
}

describe('reapStaleProcessingRequests — predicate (#2530)', () => {
  it('targets only this tenant\'s stale processing rows of the given types', async () => {
    const { reapStaleProcessingRequests } = await import('@/lib/compliance/stale-requests');
    await reapStaleProcessingRequests(TENANT_A, ['gdpr_export', 'gdpr_delete']);

    const { sql, params } = whereClauses[0];
    expect(sql).toContain('tenant_id');
    expect(sql).toContain('status');
    expect(sql).toContain('created_at');
    expect(params).toContain(TENANT_A);
    expect(params).toContain('gdpr_export');
    expect(params).toContain('gdpr_delete');
    expect(params).toContain('processing');
    // A pending or completed row must not be swept up: status equality, not
    // inequality (identifiers come back double-quoted from the pg dialect)
    expect(sql).toMatch(/"status" = /);
  });

  it('reaps only rows strictly older than the 15-minute cutoff — fresh processing rows survive', async () => {
    const { reapStaleProcessingRequests } = await import('@/lib/compliance/stale-requests');
    const before = Date.now();
    await reapStaleProcessingRequests(TENANT_A, ['soc2_report']);
    const cutoff = cutoffParam().getTime();
    expect(whereClauses[0].sql).toMatch(/"created_at" </);
    expect(cutoff).toBeLessThanOrEqual(before - STALE_MS + 5_000);
    expect(cutoff).toBeGreaterThanOrEqual(before - STALE_MS - 5_000);
  });

  it('lands the row on the terminal `failed` state with a #2530-attributed message', async () => {
    const { reapStaleProcessingRequests } = await import('@/lib/compliance/stale-requests');
    await reapStaleProcessingRequests(TENANT_A, ['gdpr_delete']);
    expect(setPayloads[0]).toMatchObject({ status: 'failed' });
    expect(String(setPayloads[0]['errorMessage'])).toContain('#2530');
    expect(String(setPayloads[0]['errorMessage'])).toContain('processing');
    expect(returningRequested).toBe(true);
  });
});

describe('GET /api/tenant/compliance/gdpr — reaps before listing (#2530)', () => {
  it('runs the reap for both gdpr types, then the listing selects', async () => {
    const { GET } = await import('@/app/api/tenant/compliance/gdpr/route');
    const res = await GET(getReq('/api/tenant/compliance/gdpr'));
    expect(res.status).toBe(200);
    const kinds = calls.map((c) => c.kind);
    expect(kinds[0]).toBe('update');
    expect(kinds).toEqual(['update', 'select', 'select']);
    expect(whereClauses[0].params).toContain('gdpr_export');
    expect(whereClauses[0].params).toContain('gdpr_delete');
    expect(whereClauses[0].params).not.toContain('soc2_report');
  });

  it('leaves the listing response shape untouched', async () => {
    const { GET } = await import('@/app/api/tenant/compliance/gdpr/route');
    const body = await (await GET(getReq('/api/tenant/compliance/gdpr'))).json();
    expect(Object.keys(body.data)).toEqual(['exports', 'deletions']);
  });
});

describe('GET /api/tenant/compliance/soc2 — reaps before listing (#2530)', () => {
  it('runs the reap for soc2_report only, then the listing select', async () => {
    const { GET } = await import('@/app/api/tenant/compliance/soc2/route');
    const res = await GET(getReq('/api/tenant/compliance/soc2'));
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.kind)).toEqual(['update', 'select']);
    expect(whereClauses[0].params).toContain('soc2_report');
    expect(whereClauses[0].params).not.toContain('gdpr_export');
  });
});
