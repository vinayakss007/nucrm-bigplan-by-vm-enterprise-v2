/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 A3 — the Approval Rules tab was backed by a route answering a
 * hardcoded `{ data: [] }`. An admin could never create the first rule, and an
 * empty state was indistinguishable from an unimplemented feature. This file
 * pins the storage+CRUD contract: real tenant-scoped rows, admin-only writes,
 * Zod validation, and tombstone deletes. The producer half (rules gating a
 * change) is deliberately out of scope and remains a follow-up.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RULE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const dialect = new PgDialect({} as never);
const render = (predicate: unknown) => {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
};

const mockRequireAuth = vi.fn();

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: (...args: unknown[]) => mockRequireAuth(...args) };
});

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C,>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const state = {
  selectRows: [] as unknown[],
  insertRows: [] as unknown[],
  updateRows: [] as unknown[],
  insertValues: [] as Record<string, unknown>[],
  updateSets: [] as Record<string, unknown>[],
  selectWhere: [] as ReturnType<typeof render>[],
  updateWhere: [] as ReturnType<typeof render>[],
  updateTable: [] as string[],
};

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      b.from = () => b;
      b.where = (p: unknown) => { state.selectWhere.push(render(p)); return b; };
      b.orderBy = () => b;
      b.limit = () => Promise.resolve(state.selectRows);
      return b;
    },
    insert: (table: unknown) => {
      const b: Record<string, unknown> = {};
      b.values = (v: Record<string, unknown>) => { state.insertValues.push({ ...v, __table: getTableName(table as never) }); return b; };
      b.returning = () => Promise.resolve(state.insertRows);
      return b;
    },
    update: (table: unknown) => {
      const b: Record<string, unknown> = {};
      b.set = (v: Record<string, unknown>) => { state.updateSets.push(v); state.updateTable.push(getTableName(table as never)); return b; };
      b.where = (p: unknown) => { state.updateWhere.push(render(p)); return b; };
      b.returning = () => Promise.resolve(state.updateRows);
      return b;
    },
  },
}));

import {
  GET, POST, PATCH, DELETE,
} from '@/app/api/tenant/rbac/approval-rules/route';

const asAdmin = () => mockRequireAuth.mockResolvedValue({
  userId: ADMIN, tenantId: TENANT, isAdmin: true, isSuperAdmin: false, roleSlug: 'admin',
});
const asRep = () => mockRequireAuth.mockResolvedValue({
  userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tenantId: TENANT,
  isAdmin: false, isSuperAdmin: false, roleSlug: 'rep',
});
const unauth = () => mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

const jsonReq = (url: string, body?: unknown) => new NextRequest(url, {
  method: body === undefined ? 'GET' : 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});
const GET_URL = 'http://localhost:3000/api/tenant/rbac/approval-rules';
const idUrl = (id: string) => `${GET_URL}?id=${id}`;
const validRule = {
  name: 'Big deals', entityType: 'deal', conditionField: 'amount',
  conditionOperator: '>=', conditionValue: 10000,
  approverRoleSlug: 'manager', autoApproveRoles: ['vp'], isActive: true,
};
const row = {
  id: RULE, name: 'Big deals', entityType: 'deal', conditionField: 'amount',
  conditionOperator: '>=', conditionValue: '10000', approverRoleSlug: 'manager',
  autoApproveRoles: ['vp'], isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-02T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  state.selectRows = []; state.insertRows = []; state.updateRows = [];
  state.insertValues = []; state.updateSets = [];
  state.selectWhere = []; state.updateWhere = []; state.updateTable = [];
});

describe('GET /api/tenant/rbac/approval-rules (#2597)', () => {
  it('is backed by real persistence, not the old hardcoded empty list', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../app/api/tenant/rbac/approval-rules/route.ts', import.meta.url)),
      'utf8',
    );
    expect(src).toMatch(/db\s*\.\s*select\(ruleColumns\)/);
    expect(src).toMatch(/db\s*\.\s*insert\(approvalRules\)/);
    expect(src).not.toMatch(/NextResponse\.json\(\{\s*data:\s*\[\]\s*\}/);
  });

  it('answers 401 when unauthenticated', async () => {
    unauth();
    const res = (await GET(jsonReq(GET_URL), {} as never)) as NextResponse;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('answers 403 when user is not an admin', async () => {
    asRep();
    const res = (await GET(jsonReq(GET_URL), {} as never)) as NextResponse;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Admin required' });
  });

  it('answers 200 with an empty list when no rules are configured', async () => {
    asAdmin();
    const res = (await GET(jsonReq(GET_URL), {} as never)) as NextResponse;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it('returns persisted rules with both the flat and tab shapes', async () => {
    asAdmin();
    state.selectRows = [row];
    const res = (await GET(jsonReq(GET_URL), {} as never)) as NextResponse;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: RULE, name: 'Big deals', entityType: 'deal',
      conditionField: 'amount', conditionOperator: '>=',
      conditionValue: '10000', approverRoleSlug: 'manager',
      autoApproveRoles: ['vp'], isActive: true,
      conditions: { field: 'amount', operator: '>=', value: '10000' },
      approvers: ['manager', 'vp'],
    });
  });

  it('scopes the read to the caller tenant and live rows', async () => {
    asAdmin();
    await GET(jsonReq(GET_URL), {} as never);
    expect(state.selectWhere).toHaveLength(1);
    const { sql, params } = state.selectWhere[0]!;
    expect(sql).toContain('tenant_id');
    expect(sql).toContain('deleted_at');
    expect(params).toContain(TENANT);
    expect(params).not.toContain(OTHER_TENANT);
  });
});

describe('POST /api/tenant/rbac/approval-rules (#2597)', () => {
  it('rejects an invalid body with 400 before touching the db', async () => {
    asAdmin();
    const res = (await POST(jsonReq(GET_URL, { name: '' }), {} as never)) as NextResponse;
    expect(res.status).toBe(400);
    expect(state.insertValues).toHaveLength(0);
  });

  it('creates a rule in the caller tenant and returns 201', async () => {
    asAdmin();
    state.insertRows = [row];
    const res = (await POST(jsonReq(GET_URL, validRule), {} as never)) as NextResponse;
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: RULE, name: 'Big deals', approvers: ['manager', 'vp'] });
    expect(state.insertValues).toHaveLength(1);
    expect(state.insertValues[0]).toMatchObject({
      tenantId: TENANT, createdBy: ADMIN, name: 'Big deals',
      conditionValue: '10000', autoApproveRoles: ['vp'], isActive: true,
      __table: 'approval_rules',
    });
  });

  it('keeps a non-admin out', async () => {
    asRep();
    const res = (await POST(jsonReq(GET_URL, validRule), {} as never)) as NextResponse;
    expect(res.status).toBe(403);
    expect(state.insertValues).toHaveLength(0);
  });
});

describe('PATCH /api/tenant/rbac/approval-rules (#2597)', () => {
  it('rejects a malformed id with 400', async () => {
    asAdmin();
    const res = (await PATCH(jsonReq(idUrl('not-a-uuid'), { isActive: false }), {} as never)) as NextResponse;
    expect(res.status).toBe(400);
    expect(state.updateSets).toHaveLength(0);
  });

  it('rejects an empty patch', async () => {
    asAdmin();
    const res = (await PATCH(jsonReq(idUrl(RULE), {}), {} as never)) as NextResponse;
    expect(res.status).toBe(400);
    expect(state.updateSets).toHaveLength(0);
  });

  it('answers 404 when the rule is not in this tenant', async () => {
    asAdmin();
    state.updateRows = [];
    const res = (await PATCH(jsonReq(idUrl(RULE), { isActive: false }), {} as never)) as NextResponse;
    expect(res.status).toBe(404);
    expect(state.updateTable).toEqual(['approval_rules']);
    const { sql, params } = state.updateWhere[0]!;
    expect(sql).toContain('tenant_id');
    expect(params).toContain(TENANT);
    expect(params).toContain(RULE);
  });

  it('updates only the fields supplied', async () => {
    asAdmin();
    state.updateRows = [{ ...row, isActive: false }];
    const res = (await PATCH(jsonReq(idUrl(RULE), { isActive: false }), {} as never)) as NextResponse;
    expect(res.status).toBe(200);
    expect((await res.json()).data.isActive).toBe(false);
    expect(state.updateSets[0]).toMatchObject({ isActive: false });
    expect(Object.keys(state.updateSets[0]!).sort()).toEqual(['isActive', 'updatedAt']);
  });
});

describe('DELETE /api/tenant/rbac/approval-rules (#2597)', () => {
  it('answers 404 when nothing was tombstoned', async () => {
    asAdmin();
    state.updateRows = [];
    const res = (await DELETE(jsonReq(idUrl(RULE)), {} as never)) as NextResponse;
    expect(res.status).toBe(404);
  });

  it('tombstones with tenant + id + deletedAt IS NULL', async () => {
    asAdmin();
    state.updateRows = [{ id: RULE }];
    const res = (await DELETE(jsonReq(idUrl(RULE)), {} as never)) as NextResponse;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(state.updateSets[0]!.deletedAt).toBeInstanceOf(Date);
    const { sql, params } = state.updateWhere[0]!;
    expect(sql).toContain('tenant_id');
    expect(sql).toContain('deleted_at');
    expect(params).toContain(TENANT);
    expect(params).toContain(RULE);
  });

  it('keeps a non-admin out', async () => {
    asRep();
    const res = (await DELETE(jsonReq(idUrl(RULE)), {} as never)) as NextResponse;
    expect(res.status).toBe(403);
    expect(state.updateSets).toHaveLength(0);
  });
});
