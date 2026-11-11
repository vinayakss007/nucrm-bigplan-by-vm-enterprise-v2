/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * `DELETE /api/tenant/trash { purge_all: true }` used to be one statement:
 * `SELECT public.purge_trash()`, whose `purged` came back as the function's
 * `v_count` — a per-DELETE-statement counter (max 4), never a row count. PP-045.
 *
 * Two consequences are pinned here: the count the panel toast shows is the number
 * of rows the 30-day window actually covers across all six trash tables (the
 * function only touches four, so leads and projects were silently kept), and the
 * two tables the function cannot reach are deleted explicitly under the caller's
 * tenant. A manual destructive purge also has to leave an audit row, which it
 * previously did not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const dialect = new PgDialect();
const toSql = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

const TENANT = 'tenant-1';
const CALLER = 'user-1';

type Captured = { sql: string; params: unknown[] };

const mockState = {
  executes: [] as Captured[],
  deletes: [] as Array<{ table: string; where: Captured }>,
  audits: [] as Array<Record<string, unknown>>,
  countRows: [{ n: 4000 }] as Array<Record<string, unknown>>,
};

/**
 * The statements this route issues, found by what they say rather than by
 * position. The purge path sets the `app.include_deleted` GUC before it
 * counts (the policies are armed on `deleted_at`, so the count has to see
 * the tombstones), which means the count is no longer the first statement
 * executed — and a positional index would silently read the GUC call as
 * the count.
 */
const statements = {
  guc: () => mockState.executes.filter((e) => e.sql.includes('set_config')),
  count: () => mockState.executes.find((e) => e.sql.includes('count(*)')),
  purgeTrash: () => mockState.executes.find((e) => e.sql.includes('public.purge_trash()')),
};

const mockDb = {
  execute: vi.fn(async (fragment: unknown) => {
    const q = toSql(fragment);
    mockState.executes.push(q);
    // The count query is the one that asks for `count(*)`; every other
    // statement (the GUC set/clear, the purge function) has no rows.
    return { rows: q.sql.includes('count(*)') ? mockState.countRows : [] };
  }),
  delete: vi.fn((table: Parameters<typeof getTableName>[0]) => ({
    where: async (predicate: unknown) => {
      mockState.deletes.push({
        table: getTableName(table),
        where: toSql(predicate),
      });
      return { rowCount: 1 };
    },
  })),
};

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: CALLER, isAdmin: true })),
}));
vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T>(fn: T) => fn }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => {
    mockState.audits.push(entry);
  }),
}));

const { DELETE } = await import('@/app/api/tenant/trash/route');

type Req = import('next/server').NextRequest;
function purgeRequest(body: unknown): Req {
  return new Request('http://localhost/api/tenant/trash', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.executes.length = 0;
  mockState.deletes.length = 0;
  mockState.audits.length = 0;
  mockState.countRows = [{ n: 4000 }];
});

describe('DELETE /api/tenant/trash — purge_all', () => {
  it('reports the qualifying row count, not purge_trash()’s statement counter', async () => {
    const json = await (await DELETE(purgeRequest({ purge_all: true }))).json();
    expect(json).toEqual({ ok: true, purged: 4000 });
  });

  it('counts every trash table the UI shows, not just the four the function covers', async () => {
    await DELETE(purgeRequest({ purge_all: true }));
    const count = statements.count()?.sql;
    expect(count, 'the count query was never issued').toBeDefined();
    for (const table of ['contacts', 'deals', 'companies', 'tasks', 'leads', 'projects']) {
      expect(count).toContain(`"${table}"`);
    }
    expect(count!.match(/count\(\*\)/g)).toHaveLength(6);
  });

  it('still calls purge_trash() for the four tables it owns', async () => {
    await DELETE(purgeRequest({ purge_all: true }));
    expect(statements.purgeTrash()?.sql).toContain('public.purge_trash()');
  });

  it('deletes the two tables purge_trash() cannot reach, scoped to the caller tenant', async () => {
    await DELETE(purgeRequest({ purge_all: true }));
    expect(mockState.deletes.map((d) => d.table)).toEqual(['leads', 'projects']);
    for (const del of mockState.deletes) {
      expect(del.where.sql).toContain('deleted_at');
      expect(del.where.params).toContain(TENANT);
      expect(del.where.params).not.toContain(CALLER);
    }
  });

  it('writes an audit row for a destructive manual purge', async () => {
    await DELETE(purgeRequest({ purge_all: true }));
    expect(mockState.audits).toEqual([
      {
        tenantId: TENANT,
        userId: CALLER,
        action: 'purge_trash',
        entityType: 'trash',
        metadata: { purged: 4000 },
      },
    ]);
  });

  it('falls back to 0 when the count returns nothing, rather than reporting undefined', async () => {
    mockState.countRows = [];
    const json = await (await DELETE(purgeRequest({ purge_all: true }))).json();
    expect(json).toEqual({ ok: true, purged: 0 });
    expect(mockState.audits[0].metadata).toEqual({ purged: 0 });
  });

  it('leaves the single-row delete path untouched by the purge-all branch', async () => {
    const json = await (
      await DELETE(purgeRequest({ id: 'row-9', resource_type: 'deal' }))
    ).json();
    expect(json).toEqual({ ok: true });
    // The single-row delete now sets and clears the `app.include_deleted` GUC
    // (the policy on a `deleted_at` table is armed, so the DELETE's USING /
    // WITH CHECK needs the GUC or the row is invisible to it). What must NOT
    // happen is the purge_all path's work: no count query, no purge_trash().
    expect(statements.count()).toBeUndefined();
    expect(statements.purgeTrash()).toBeUndefined();
    expect(mockState.deletes.map((d) => d.table)).toEqual(['deals']);
  });
});
