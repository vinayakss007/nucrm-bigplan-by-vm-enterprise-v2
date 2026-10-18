/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2674 — bulk tasks were scoped by tenant, and by nothing that mattered.
 *
 * `GET/PATCH/DELETE /api/tenant/tasks/[id]` all refuse a user who lacks
 * `tasks.view_all` when the task is not theirs (`tasks/[id]/route.ts:55-59`,
 * `:100-105`, `:197+`), and the list narrows the same way
 * (`tasks/route.ts:38-40` — `or(assigned_to, created_by)`).
 * `POST /api/tenant/tasks/bulk` did not mention `view_all` at all: both id sets it
 * resolves were scoped by tenant + tombstone only, and every action writes the set
 * the validation produced. So a rep who cannot open a colleague's task could
 * reassign it, change its priority, complete or reopen it, move its due date, or
 * delete it — through "select all matching" (which enumerated the whole tenant) or
 * by naming ids directly.
 *
 * Asserted on the SQL drizzle renders. A mocked `db` returns whatever it is told,
 * so a canned row set passes with no ownership predicate anywhere — which is
 * exactly how this shipped.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK = '44444444-4444-4444-8444-444444444444';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let selectCall = 0;
let rowsPerCall: unknown[][] = [];
const mockDb = { select: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  // Only `requireAuth` is faked: `can()` is the rule under test and stays real.
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
  enforceFieldRead: (_ctx: unknown, _entity: string, rows: unknown[]) => Promise.resolve(rows),
}));

const { requireAuth } = await import('@/lib/auth/middleware');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function setup(rows: unknown[][]) {
  vi.resetModules();
  wheres = [];
  selectCall = 0;
  rowsPerCall = rows;
  mockDb.select.mockImplementation(() => {
    const r = rowsPerCall[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(r);
  });
}

async function post(body: unknown, ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const { POST } = await import('@/app/api/tenant/tasks/bulk/route');
  return POST(new NextRequest(new URL('/api/tenant/tasks/bulk', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  }));
}

// A rep with no `tasks.view_all`: exactly the role the [id] handlers refuse.
const LIMITED = { 'tasks.view': true, 'tasks.edit': true, 'tasks.assign': true };
// The same rep promoted: the predicate must disappear, not merely be joined in.
const BROAD = { ...LIMITED, 'tasks.view_all': true };

const ownsBoth = (clause: { sql: string; params: unknown[] }) =>
  /"tasks"\."assigned_to".*=.*or.*"tasks"\."created_by".*=/.test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

describe('select-all matching is scoped to tasks the caller may touch (#2674)', () => {
  it('the tenant-wide enumeration becomes an owner-scoped one', async () => {
    setup([[{ id: TASK }], [{ id: TASK }]]);
    const res = await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(LIMITED));
    // `payload.assigned_to` is absent, so the handler stops before writing — after
    // both id sets have already been resolved, which is what is being pinned.
    expect(res.status, await res.text()).toBe(400);

    const enumerated = wheres[0];
    expect(enumerated.sql).toContain('"tasks"."tenant_id"');
    expect(enumerated.sql).toMatch(/"tasks"\."deleted_at" is null/i);
    expect(ownsBoth(enumerated), `no ownership predicate: ${enumerated.sql}`).toBe(true);
  });

  it('a client cannot widen it back by naming another owner', async () => {
    setup([[{ id: TASK }], [{ id: TASK }]]);
    const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await post({ action: 'assign', selectAll: true, filters: { assigned_to: OTHER } }, ctxWith(LIMITED));
    // The caller's `assigned_to` lands in the same AND as the scope, so it can
    // only narrow the set further — naming somebody else never re-widens it to
    // the whole tenant, and never replaces the narrowing.
    expect(ownsBoth(wheres[0]), `no ownership predicate: ${wheres[0].sql}`).toBe(true);
    expect(wheres[0].params).toContain(OTHER);
    expect(wheres[0].sql).toMatch(/\band\b/i);
  });

  it('every filter the route honours survives the narrowing', async () => {
    setup([[{ id: TASK }], [{ id: TASK }]]);
    await post({
      action: 'assign',
      selectAll: true,
      filters: { status: 'open', priority: 'urgent', q: 'call' },
    }, ctxWith(LIMITED));
    expect(wheres[0].sql).toMatch(/"tasks"\."status"/);
    expect(wheres[0].sql).toMatch(/"tasks"\."priority"/);
    expect(wheres[0].sql).toMatch(/"tasks"\."title"/i);
    expect(wheres[0].sql).toMatch(/ilike/i);
    expect(ownsBoth(wheres[0])).toBe(true);
  });

  it('a user with tasks.view_all keeps the whole-tenant scope', async () => {
    setup([[{ id: TASK }], [{ id: TASK }]]);
    await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(BROAD));
    expect(wheres[0].sql).not.toMatch(/"tasks"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT]);
  });
});

describe('an explicit task_ids list is validated against the same scope (#2674)', () => {
  it('the id validation refuses tasks the caller does not own', async () => {
    setup([[{ id: TASK }]]);
    const res = await post({ action: 'assign', task_ids: [TASK] }, ctxWith(LIMITED));
    expect(res.status, await res.text()).toBe(400);
    expect(ownsBoth(wheres[0]), `no ownership predicate: ${wheres[0].sql}`).toBe(true);
    expect(wheres[0].sql).toContain('"tasks"."id" in');
  });

  it('selecting all leaves nothing outside the scope to validate', async () => {
    // Both paths must narrow, or `selectAll` + a foreign id smuggles the row past
    // whichever one is unguarded.
    setup([[{ id: TASK }], [{ id: TASK }]]);
    await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(LIMITED));
    expect(wheres).toHaveLength(2);
    expect(wheres.every(ownsBoth)).toBe(true);
  });

  it('a task the enumeration finds but the scope refuses is a 404, not a write', async () => {
    // Query 1 (enumeration) hands back the id; query 2 (validation) applies the
    // scope and drops it, so nothing reaches the update.
    setup([[{ id: TASK }], []]);
    const res = await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(LIMITED));
    expect(res.status, await res.text()).toBe(404);
    expect(wheres[1].sql).toContain('"tasks"."id" in');
    expect(ownsBoth(wheres[1])).toBe(true);
  });
});
