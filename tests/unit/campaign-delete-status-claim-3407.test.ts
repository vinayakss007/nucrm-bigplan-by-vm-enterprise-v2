/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — DELETE /api/tenant/lead-warming/campaigns/[id] forces
 * `status:'archived'`; it must claim the from-state like the invoice /
 * subscription / DLQ writers (#3628, #3637, #3635).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMPAIGN = '66666666-6666-4666-8666-666666666666';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  status: 'active' as string | null,
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
};

function makeUpdateNode(): Record<string, unknown> {
  let rec: Captured = { sql: '', params: [], set: {} };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    where: (pred: unknown) => {
      const r = dialect.sqlToQuery(pred as never);
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

const db: Record<string, unknown> = {
  select: () => {
    const b: Record<string, unknown> = {};
    b['from'] = () => b;
    b['where'] = () => b;
    b['limit'] = () => Promise.resolve(state.status === null ? [] : [{ status: state.status }]);
    return b;
  },
  update: makeUpdateNode,
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn(async () => ctx), can: () => true };
});
vi.mock('@/lib/ai/plan-gate', () => ({ requireAiFeature: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => undefined }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-error')>('@/lib/api-error');
  return { ...actual, apiError: vi.fn((err: unknown) => { throw err; }) };
});

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

async function del() {
  const { DELETE } = await import('@/app/api/tenant/lead-warming/campaigns/[id]/route');
  return DELETE(
    new NextRequest(`http://localhost:3000/api/tenant/lead-warming/campaigns/${CAMPAIGN}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: CAMPAIGN }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  state.status = 'active';
  state.updateReturns = [];
  state.updates = [];
});

describe('campaign DELETE claims its from-status (#3407)', () => {
  it('pins the read status, tenant and id in the WHERE', async () => {
    state.updateReturns = [[{ id: CAMPAIGN }]];
    const res = await del();
    expect(res.status).toBe(200);
    const w = state.updates[0];
    expect(w.sql).toMatch(/"lead_warming_campaigns"\."status" = /i);
    expect(w.params).toEqual([CAMPAIGN, TENANT, 'active']);
    expect(w.set).toMatchObject({ status: 'archived' });
  });

  it('a lost claim answers 409, not a false archived success', async () => {
    state.status = 'active';
    state.updateReturns = [[]];
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("cannot archive from 'active'");
  });

  it('a missing campaign is 404 and issues no UPDATE', async () => {
    state.status = null;
    const res = await del();
    expect(res.status).toBe(404);
    expect(state.updates).toEqual([]);
  });
});
