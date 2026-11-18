/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — PATCH /api/tenant/jobs/dead-letter writes `status` on retry and
 * resolve, but concurrencyGuardById is a no-op without expectedUpdatedAt. A
 * stale retry could therefore overwrite a concurrent resolution. The handler
 * now reads the from-state and pins it in each UPDATE's WHERE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  status: 'pending' as string | null,
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
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
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
}));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuardById: vi.fn(async () => null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({ apiError: vi.fn((err: unknown) => { throw err; }) }));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'admin', permissions: { 'settings.manage': true },
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

async function patch(action: string) {
  const { PATCH } = await import('@/app/api/tenant/jobs/dead-letter/route');
  return PATCH(
    new NextRequest('http://localhost:3000/api/tenant/jobs/dead-letter', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: JOB, action }),
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
  state.status = 'pending';
  state.updateReturns = [];
  state.updates = [];
});

describe('dead-letter status writes claim their from-state (#3407)', () => {
  it('retry pins the read status, tenant and job id in the WHERE', async () => {
    state.updateReturns = [[{ id: JOB }]];
    const res = await patch('retry');
    expect(res.status).toBe(200);
    const write = state.updates[0];
    expect(write.sql).toMatch(/"dead_letter_queue"\."status" = /i);
    expect(write.params).toEqual([JOB, TENANT, 'pending']);
    expect(write.set).toMatchObject({ status: 'pending' });
  });

  it('resolve pins the read status and returns 409 when the claim is lost', async () => {
    state.status = 'pending';
    state.updateReturns = [[]];
    const res = await patch('resolve');
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("cannot resolve from 'pending'");
    const write = state.updates[0];
    expect(write.sql).toMatch(/"dead_letter_queue"\."status" = /i);
    expect(write.set).toMatchObject({ status: 'resolved' });
  });

  it('a missing job is 404 and issues no UPDATE', async () => {
    state.status = null;
    const res = await patch('retry');
    expect(res.status).toBe(404);
    expect(state.updates).toEqual([]);
  });
});
