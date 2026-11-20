/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — PATCH /api/tenant/follow-ups/[id] writes status (and, on 'completed',
 * completedAt/missedDays) but concurrencyGuard only compares when the client
 * supplied expectedUpdatedAt. Without that token a concurrent complete/reopen
 * could be overwritten and leave the derived fields inconsistent. The write now
 * claims the live status when the payload writes status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FU = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  currentStatus: 'pending' as string | null,
  updateReturns: [] as unknown[][],
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
      return Promise.resolve(state.updateReturns[at] ?? []);
    },
  };
  return node;
}

function makeSelectNode(): Record<string, unknown> {
  const node: Record<string, unknown> = {};
  node['from'] = () => node;
  node['where'] = () => node;
  node['limit'] = () => Promise.resolve(state.currentStatus ? [{ status: state.currentStatus }] : []);
  return node;
}

const db: Record<string, unknown> = {
  select: makeSelectNode,
  update: makeUpdateNode,
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx), requirePerm: vi.fn(() => null) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async () => ({ status: 'completed' })),
  validateBody: vi.fn(() => ({ data: { status: 'completed' } })),
}));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-error')>('@/lib/api-error');
  return { ...actual, apiError: vi.fn((err: unknown) => { throw err; }) };
});

const ctx = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'tasks.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as never;

async function patch() {
  const { PATCH } = await import('@/app/api/tenant/follow-ups/[id]/route');
  return PATCH(
    new NextRequest(`http://localhost:3000/api/tenant/follow-ups/${FU}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ id: FU }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  state.currentStatus = 'pending';
  state.updateReturns = [];
  state.updates = [];
});

describe('follow-up status write claims its from-state (#3407)', () => {
  it('pins the read status in the WHERE on success', async () => {
    state.updateReturns = [[{ id: FU }]];
    const res = await patch();
    expect(res.status).toBe(200);
    const w = state.updates[0];
    expect(w.sql).toMatch(/"follow_ups"\."status" = /i);
    expect(w.params).toContain('pending');
    expect(w.set).toMatchObject({ status: 'completed' });
  });

  it('a lost claim answers 409', async () => {
    state.updateReturns = [[]];
    const res = await patch();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("cannot update from 'pending'");
  });

  it('a missing live row is 404', async () => {
    state.currentStatus = null;
    const res = await patch();
    expect(res.status).toBe(404);
  });
});
