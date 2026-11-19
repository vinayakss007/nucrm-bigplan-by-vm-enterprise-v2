/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — `POST /api/tenant/tasks/bulk` wrote `status` for `complete`/`reopen`
 * with `WHERE id IN (...)` + tenant only. A task that moved or was deleted in
 * the gap between the unlocked validation read and the write was stomped, and
 * the response claimed it had been changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK = '44444444-4444-4444-8444-444444444444';
const dialect = new PgDialect({} as never);

type UpdateRec = { table: string; set: Record<string, unknown>; sql: string; params: unknown[] };
const H = vi.hoisted(() => ({ updates: [] as UpdateRec[], returning: [] as unknown[][] }));

function recordingUpdate(table: unknown): Record<string, unknown> {
  let rec: UpdateRec = { table: getTableName(table as never), set: {}, sql: '', params: [] };
  const node: Record<string, unknown> = {
    set: (values: Record<string, unknown>) => { rec = { ...rec, set: values }; return node; },
    where: (predicate: unknown) => {
      const q = dialect.sqlToQuery(predicate as never);
      rec = { ...rec, sql: q.sql, params: q.params };
      return node;
    },
    returning: () => {
      H.updates.push(rec);
      return Promise.resolve(H.returning.shift() ?? []);
    },
  };
  return node;
}

const mockDb = {
  select: vi.fn(() => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ['from', 'where', 'limit', 'orderBy']) builder[m] = chain;
    builder['then'] = (resolve: (v: unknown) => unknown) => resolve([{ id: TASK }]);
    return builder;
  }),
  update: vi.fn((table: unknown) => recordingUpdate(table)),
};

vi.mock('@/drizzle/db', () => ({
  db: new Proxy({}, { get: (_target, property) => (mockDb as Record<string | symbol, unknown>)[property] }),
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(), requirePerm: vi.fn(() => null) };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  logAudit: vi.fn(),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: (_c: unknown, _e: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
}));

import { requireAuth } from '@/lib/auth/middleware';

async function post(action: string, returning: unknown[][]) {
  H.updates = [];
  H.returning = returning;
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: MINE, tenantId: TENANT, roleSlug: 'admin', permissions: { 'tasks.view_all': true, 'tasks.edit': true },
    isAdmin: true, isSuperAdmin: false,
  });
  const { POST } = await import('@/app/api/tenant/tasks/bulk/route');
  return POST(new NextRequest(new URL('/api/tenant/tasks/bulk', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ action, task_ids: [TASK] }),
  }));
}

beforeEach(() => vi.clearAllMocks());

describe('#3407: bulk task status writes claim their from-state', () => {
  it('complete refuses to overwrite a task already completed', async () => {
    const res = await post('complete', [[{ id: TASK }]]);
    expect(res.status, await res.text()).toBe(200);
    const u = H.updates[0]!;
    expect(u.sql, u.sql).toMatch(/"tasks"\."status"\s*<>/i);
    expect(u.sql).toMatch(/"tasks"\."deleted_at" is null/i);
    expect(u.set.status).toBe('completed');
  });

  it('reopen only touches tasks still in the completed state', async () => {
    const res = await post('reopen', [[{ id: TASK }]]);
    expect(res.status, await res.text()).toBe(200);
    const u = H.updates[0]!;
    expect(u.sql, u.sql).toMatch(/"tasks"\."status"\s*=\s*\$/i);
    expect(u.sql).toMatch(/"tasks"\."deleted_at" is null/i);
    expect(u.set.status).toBe('pending');
  });

  it('reports affected=0 when the from-state claim loses the race', async () => {
    const res = await post('complete', [[]]);
    const body = await res.json() as { affected: number };
    expect(body.affected).toBe(0);
  });
});
