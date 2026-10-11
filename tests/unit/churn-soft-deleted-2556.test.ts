/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2556 — the churn read path never filtered `contacts.deletedAt`, so a
 * soft-deleted contact stayed in the churn queue with full name, email, risk
 * factors and recommended actions, and stayed calculable through the POST beside
 * it. Every other contact read in the app excludes them
 * (`app/api/tenant/contacts/route.ts:54`), and the deal side of this same feature
 * does too (`deals_by_win_probability` ends `WHERE d.deleted_at IS NULL`, copied
 * by #2555's ownership probe) — churn was the outlier, not the design.
 *
 * The filter is asserted on the SQL drizzle actually renders, not on a mocked
 * return value: a mocked db answers whatever it is told, so a canned row would
 * pass with no `deleted_at` clause at all. Both handlers are pinned because the
 * issue's own caveat says fixing one alone re-opens the disagreement inside one
 * file — that is how #2555 ended up deliberately leaving the POST as it found it.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const ROOT = join(import.meta.dirname!, '../..');
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const CONTACT_A = '44444444-4444-4444-8444-444444444444';

const mockRequireAuth = vi.fn();
const mockCan = vi.fn().mockReturnValue(true);
const mockDb = {
  select: vi.fn(),
  execute: vi.fn().mockResolvedValue({ rows: [{ probability: 0.42 }] }),
};

const dialect = new PgDialect({} as never);
let selectResults: unknown[][] = [];
let selectCall = 0;
let whereClauses: { sql: string; params: unknown[] }[] = [];

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'orderBy', 'limit']) builder[m] = chain;
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

function ctx(): AuthContext {
  return {
    userId: 'user-a-001',
    tenantId: TENANT_A,
    roleSlug: 'admin',
    permissions: { 'reports.view': true, 'contacts.edit': true },
    isAdmin: true,
    isSuperAdmin: false,
  } as AuthContext;
}

function req(path: string, init?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

function setup(rowsForFirstQuery: unknown[][]) {
  vi.resetModules();
  whereClauses = [];
  selectCall = 0;
  selectResults = rowsForFirstQuery;
  mockDb.select.mockImplementation(() => {
    const rows = selectResults[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(rows);
  });
  mockDb.execute.mockClear().mockResolvedValue({ rows: [{ probability: 0.42 }] });
  mockRequireAuth.mockResolvedValue(ctx());
  mockCan.mockReturnValue(true);
}

const clause = (n: number) => {
  expect(whereClauses[n], `expected a where clause on query #${n}`).toBeDefined();
  return whereClauses[n];
};

describe('GET /api/tenant/analytics/churn — soft-deleted contacts are not listed (#2556)', () => {
  it('binds contacts.deleted_at IS NULL alongside the tenant filter', async () => {
    setup([[{ id: 'prediction-1', contactId: CONTACT_A }]]);
    const { GET } = await import('@/app/api/tenant/analytics/churn/route');
    const res = await GET(req('/api/tenant/analytics/churn'));

    expect(res.status).toBe(200);
    const read = clause(0);
    expect(read.sql).toContain('"churn_predictions"."tenant_id"');
    expect(read.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    // IS NULL binds nothing, so the parameter list stays exactly the tenant — a
    // regression that turned this into `= NULL` would show up here as a new param.
    expect(read.params).toEqual([TENANT_A]);
  });

  it('keeps the filter when a risk_level narrows the queue', async () => {
    setup([[]]);
    const { GET } = await import('@/app/api/tenant/analytics/churn/route');
    await GET(req('/api/tenant/analytics/churn?risk_level=high'));

    const read = clause(0);
    expect(read.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(read.sql).toContain('"churn_predictions"."churn_risk"');
    expect(read.params).toEqual([TENANT_A, 'high']);
  });
});

describe('POST /api/tenant/analytics/churn — a soft-deleted contact is not calculable (#2556)', () => {
  it('puts deleted_at IS NULL in the ownership probe, matching the deal side (#2524/#2555)', async () => {
    setup([[{ id: CONTACT_A }], [{ id: 'prediction-1' }]]);
    const { POST } = await import('@/app/api/tenant/analytics/churn/route');
    const res = await POST(req('/api/tenant/analytics/churn', {
      method: 'POST',
      body: { contact_id: CONTACT_A },
    }));

    expect(res.status).toBe(200);
    const probe = clause(0);
    expect(probe.sql).toContain('"contacts"."tenant_id"');
    expect(probe.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(probe.params).toEqual([CONTACT_A, TENANT_A]);
  });

  it('answers 404 for a contact the probe rejects and never reaches the RPC', async () => {
    // The row a GET used to list and this POST used to score: soft-deleted, so the
    // probe legitimately finds nothing.
    setup([[]]);
    const { POST } = await import('@/app/api/tenant/analytics/churn/route');
    const res = await POST(req('/api/tenant/analytics/churn', {
      method: 'POST',
      body: { contact_id: CONTACT_A },
    }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Contact not found' });
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(selectCall).toBe(1);
  });
});

describe('the advertised paths are the mounted ones (#2556)', () => {
  // Both analytics POSTs documented a `.../calculate` endpoint that does not
  // exist, which is how the two handlers stayed unexamined. Pin the absence so a
  // re-rot of the comment cannot outlive the tree again.
  const ANALYTICS = join(ROOT, 'app/api/tenant/analytics');

  it('has no calculate route under app/api/tenant/analytics', () => {
    const withCalculate = readdirSync(ANALYTICS, { recursive: true })
      .filter((p) => String(p).split(/[\\/]/).includes('calculate'));
    expect(withCalculate).toEqual([]);
  });

  it('names each POST handler at the path it is actually served from', () => {
    for (const [file, mounted] of [
      ['churn', 'POST /api/tenant/analytics/churn\n'],
      ['forecast', 'POST /api/tenant/analytics/forecast\n'],
    ] as [string, string][]) {
      const src = readFileSync(join(ANALYTICS, file, 'route.ts'), 'utf8');
      expect(src, `${file} still advertises a route that does not exist`).toContain(mounted);
      expect(src).not.toContain(`/api/tenant/analytics/${file}/calculate`);
    }
  });
});
