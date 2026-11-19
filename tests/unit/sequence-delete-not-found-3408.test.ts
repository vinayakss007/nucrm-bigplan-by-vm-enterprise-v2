/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408/#3407 — DELETE /api/tenant/sequences/[id] used to answer `ok: true`
 * even when the archive UPDATE matched zero rows (a missing/already-deleted
 * sequence), and wrote status without claiming the from-state. It now reads
 * the live row first, claims that status in the tombstone, and only reports
 * success on a won claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEQ = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  status: 'active' as string | null,
  archiveReturns: [] as unknown[][],
  updates: [] as Captured[],
};

function makeUpdateNode(): Record<string, unknown> {
  let rec: Captured = { sql: '', params: [], set: {} };
  const node: Record<string, unknown> = {
    set: (v: Record<string, unknown>) => { rec = { ...rec, set: v }; return node; },
    where: (p: unknown) => {
      const r = dialect.sqlToQuery(p as never);
      rec = { sql: r.sql, params: r.params as unknown[], set: rec.set };
      return node;
    },
    returning: () => {
      const at = state.updates.length;
      state.updates.push(rec);
      return Promise.resolve(state.archiveReturns[at] ?? []);
    },
  };
  return node;
}

const db: Record<string, unknown> = {
  select: () => {
    const b: Record<string, unknown> = {};
    b['from'] = () => b;
    b['where'] = () => b;
    b['limit'] = () => Promise.resolve(state.status === null ? [] : [{ status: state.status }]);
    return b;
  },
  update: makeUpdateNode,
  transaction: async (fn: (tx: Record<string, unknown>) => unknown) => fn(db),
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx), can: () => true };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/cron/sequence-steps', () => ({ cancelOpenEnrollments: vi.fn(async () => 2) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-error')>('@/lib/api-error');
  return { ...actual, apiError: vi.fn((err: unknown) => { throw err; }) };
});

const ctx = {
  userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as never;

async function del() {
  const { DELETE } = await import('@/app/api/tenant/sequences/[id]/route');
  return DELETE(
    new NextRequest(`http://localhost:3000/api/tenant/sequences/${SEQ}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: SEQ }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  state.status = 'active';
  state.archiveReturns = [];
  state.updates = [];
});

describe('sequence DELETE never claims false success (#3408/#3407)', () => {
  it('a missing/already-deleted sequence is 404, not ok:true', async () => {
    state.status = null;
    const res = await del();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Sequence not found');
    expect(state.updates).toEqual([]);
  });

  it('a lost archive claim is 409, not ok:true', async () => {
    state.status = 'active';
    state.archiveReturns = [[]];
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("cannot delete from 'active'");
  });

  it('a successful archive claims the read status in the WHERE', async () => {
    state.status = 'active';
    state.archiveReturns = [[{ id: SEQ }]];
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const write = state.updates[0];
    expect(write.sql).toMatch(/"sequences"\."status" = /i);
    expect(write.params).toEqual([SEQ, TENANT, 'active']);
    expect(write.set).toMatchObject({ status: 'archived' });
  });
});
