/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — DELETE /api/tenant/invoices/[id] forces `status:'cancelled'`, so it
 * is a status transition and must claim its from-state like every other writer
 * (#3346's PUT, #3499's tickets, #3595's tasks). Previously the tombstone wrote
 * with only `id + tenant + deletedAt IS NULL`, so a payment that moved the row
 * to `paid` in the gap was silently overwritten and revenue drifted.
 *
 * DB-free: the UPDATE's WHERE is rendered through PgDialect (a mock call count
 * cannot prove a missing predicate), and `.returning()` replays an empty row to
 * show a lost claim is honoured.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVOICE = '22222222-2222-2222-8222-222222222222';
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  readRows: [] as unknown[],
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
    builder['limit'] = () => Promise.resolve(state.readRows);
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
    requireCsrf: vi.fn(() => null),
  };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(async (entry: Record<string, unknown>) => { state.audits.push(entry); }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((err: unknown) => { throw err; }),
}));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'rep', permissions: { 'invoices.delete': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

async function del() {
  const { DELETE } = await import('@/app/api/tenant/invoices/[id]/route');
  return DELETE(
    new NextRequest(`http://localhost:3000/api/tenant/invoices/${INVOICE}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: INVOICE }) },
  );
}

beforeEach(() => {
  vi.resetModules();
  state.readRows = [];
  state.updateReturns = [];
  state.updates = [];
  state.audits = [];
});

describe('invoice DELETE claims its from-status (#3407)', () => {
  it('pins the read status, the tenant, the tombstone gate and an unparameterised status literal', async () => {
    state.readRows = [{ status: 'sent' }];
    state.updateReturns = [[{ id: INVOICE }]];
    const res = await del();
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    const write = state.updates[0];
    expect(write.sql).toMatch(/"invoices"\."status" = /i);
    expect(write.params).toEqual([INVOICE, TENANT, 'sent']);
    expect(write.sql).toMatch(/"invoices"\."deleted_at" IS NULL/i);
    expect(write.set).toMatchObject({ status: 'cancelled' });
    expect(state.audits.map((a) => a.action)).toEqual(['invoice.deleted']);
  });

  it('a concurrent payment that moved the invoice loses the race: 409, no audit', async () => {
    state.readRows = [{ status: 'draft' }];
    state.updateReturns = [[]]; // the row is now 'paid' — the claim missed
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("cannot cancel 'draft'");
    expect(state.audits).toEqual([]);
  });

  it('a missing or already-deleted invoice is still 404 and issues no UPDATE', async () => {
    state.readRows = [];
    const res = await del();
    expect(res.status).toBe(404);
    expect(state.updates).toEqual([]);
  });
});
