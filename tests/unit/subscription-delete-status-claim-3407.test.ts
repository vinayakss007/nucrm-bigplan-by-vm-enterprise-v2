/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — DELETE /api/tenant/subscriptions/[id] forces `status:'cancelled'`,
 * so it is a status transition and must claim its from-state (#3337 PUT,
 * #3628 invoice DELETE). A concurrent renewal landing in the gap used to be
 * silently overwritten by the tombstone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  status: 'active' as string | null,
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  audits: [] as Record<string, unknown>[],
};

function makeUpdateNode(): Record<string, unknown> {
  let rec: Captured = { sql: '', params: [], set: {} };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    where: (pred: unknown) => {
      const rendered = dialect.sqlToQuery(pred as never);
      rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
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

const db: Record<string, unknown> = {
  select: () => {
    const builder: Record<string, unknown> = {};
    builder['from'] = () => builder;
    builder['where'] = () => builder;
    builder['limit'] = () => Promise.resolve(state.status === null ? [] : [{ status: state.status }]);
    return builder;
  },
  update: makeUpdateNode,
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => ctx),
    requirePerm: vi.fn(() => null),
  };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn(async () => null) }));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({ apiError: vi.fn((err: unknown) => { throw err; }) }));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep',
  permissions: { 'subscriptions.delete': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

async function del() {
  const { DELETE } = await import('@/app/api/tenant/subscriptions/[id]/route');
  return DELETE(
    new NextRequest(`http://localhost:3000/api/tenant/subscriptions/${SUB}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: SUB }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  state.status = 'active';
  state.updateReturns = [];
  state.updates = [];
  state.audits = [];
});

describe('subscription DELETE claims its from-status (#3407)', () => {
  it('pins the read status, tenant, id and tombstone gate in the WHERE', async () => {
    state.updateReturns = [[{ id: SUB }]];
    const res = await del();
    expect(res.status).toBe(200);
    const write = state.updates[0];
    expect(write.sql).toMatch(/"service_subscriptions"\."status" = /i);
    expect(write.params).toEqual([SUB, TENANT, 'active']);
    expect(write.sql).toMatch(/"service_subscriptions"\."deleted_at" IS NULL/i);
    expect(write.set).toMatchObject({ status: 'cancelled' });
    expect(state.audits.map((a) => a.action)).toEqual(['subscription.deleted']);
  });

  it('a concurrent status change loses the race: 409 and no audit', async () => {
    state.status = 'active';
    state.updateReturns = [[]];
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("cannot cancel 'active'");
    expect(state.audits).toEqual([]);
  });

  it('a missing subscription is 404 and issues no UPDATE', async () => {
    state.status = null;
    const res = await del();
    expect(res.status).toBe(404);
    expect(state.updates).toEqual([]);
  });
});
