/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — PATCH /api/tenant/contacts/[id]/status reads `prev.leadStatus` and
 * logs an "X → Y" activity, but used to write status with only id/tenant/tombstone
 * in the WHERE. A concurrent edit could win the race while the activity still
 * recorded a transition that never happened. The write now claims the from-state
 * and a lost claim returns 409 with no activity inserted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  from: 'new' as string,
  updateReturns: [] as unknown[][],
  updates: [] as Captured[],
  activities: [] as Record<string, unknown>[],
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

const db: Record<string, unknown> = {
  query: {
    contacts: {
      findFirst: vi.fn(async () => ({
        leadStatus: state.from, assignedTo: USER, createdBy: USER,
      })),
    },
  },
  update: makeUpdateNode,
  insert: vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      state.activities.push(v);
      return Promise.resolve([]);
    },
  })),
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
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async () => ({ lead_status: 'qualified', reason: 'demo booked' })),
  validateBody: vi.fn(() => ({ data: { lead_status: 'qualified' } })),
}));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: async () => null }));
vi.mock('@/lib/api-error', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-error')>('@/lib/api-error');
  return { ...actual, apiError: vi.fn((err: unknown) => { throw err; }) };
});

const ctx = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'contacts.edit': true },
  isAdmin: false, isSuperAdmin: false,
} as never;

async function patch() {
  const { PATCH } = await import('@/app/api/tenant/contacts/[id]/status/route');
  return PATCH(
    new NextRequest(`http://localhost:3000/api/tenant/contacts/${CONTACT}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ id: CONTACT }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  state.from = 'new';
  state.updateReturns = [];
  state.updates = [];
  state.activities = [];
});

describe('contact status write claims its from-state (#3407)', () => {
  it('pins the read lead_status in the WHERE and logs the transition', async () => {
    state.updateReturns = [[{ id: CONTACT }]];
    const res = await patch();
    expect(res.status).toBe(200);
    const w = state.updates[0];
    expect(w.sql).toMatch(/"contacts"\."lead_status" = /i);
    expect(w.params).toEqual([CONTACT, TENANT, 'new']);
    expect(w.set).toMatchObject({ leadStatus: 'qualified' });
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]!.metadata).toMatchObject({ from: 'new', to: 'qualified' });
  });

  it('a lost claim answers 409 and inserts no phantom activity', async () => {
    state.updateReturns = [[]];
    const res = await patch();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("cannot move 'new'");
    expect(state.activities).toEqual([]);
  });
});
