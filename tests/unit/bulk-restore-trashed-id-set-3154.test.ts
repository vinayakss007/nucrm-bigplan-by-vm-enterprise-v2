/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3154 — bulk `restore` on tasks and companies restored nothing and said it did.
 *
 * Both routes resolve the caller's ids through a validation query filtered
 * `deletedAt IS NULL` (`tasks/bulk/route.ts:77-91`, `companies/bulk/route.ts:69-82`), and
 * both `case 'restore'` statements updated `inArray(<id>, validIds)` — the set that, by
 * construction, contains no trashed row. So a trashed id 404ed at the gate
 * ("No valid tasks found"), and a live id was written `deletedAt: null` over and counted as
 * restored. `leads` (#2692) and `contacts` (#3111) already carry the exemption and the
 * re-resolution; these two were left behind.
 *
 * Asserted on the SQL drizzle renders. A mocked `db` returns whatever it is told, which is
 * exactly how `{ affected: 3 }` kept looking like a pass: the predicate is the defect.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRASHED = '55555555-5555-4555-8555-555555555555';
const dialect = new PgDialect({} as never);

let wheres: { op: 'select' | 'update'; sql: string; params: unknown[] }[] = [];
let selectCall = 0;
let rowsPerCall: unknown[][] = [];
let updatePatch: Record<string, unknown> | null = null;
const mockDb = { select: vi.fn(), update: vi.fn() };

function makeBuilder(rows: unknown[], op: 'select' | 'update') {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'limit', 'offset', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ op, sql: rendered.sql, params: rendered.params });
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
  updatePatch = null;
  mockDb.select.mockImplementation(() => {
    const r = rowsPerCall[selectCall] ?? [];
    selectCall += 1;
    return makeBuilder(r, 'select');
  });
  mockDb.update.mockImplementation(() => {
    const builder = makeBuilder({ rowCount: 1 }, 'update');
    builder['set'] = (patch: Record<string, unknown>) => {
      updatePatch = patch;
      return builder;
    };
    return builder;
  });
}

// Spelled out per module: a template-literal specifier loses its extension to Vite.
const LOADERS: Record<string, () => Promise<unknown>> = {
  tasks: () => import('@/app/api/tenant/tasks/bulk/route'),
  companies: () => import('@/app/api/tenant/companies/bulk/route'),
};

async function post(module: string, idKey: string, body: Record<string, unknown>, ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const { POST } = (await LOADERS[module]()) as {
    POST: (req: NextRequest, ctx?: unknown) => Promise<import('next/server').NextResponse>,
  };
  return POST(new NextRequest(new URL(`/api/tenant/${module}/bulk`, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify({ action: 'restore', [idKey]: [TRASHED], payload: {}, ...body }),
  }));
}

const ROUTES = [
  { module: 'tasks', idKey: 'task_ids', perm: 'tasks.edit', entity: 'tasks' },
  { module: 'companies', idKey: 'company_ids', perm: 'companies.edit', entity: 'companies' },
] as const;

const readsTheTrashedSet = (clause: { sql: string; params: unknown[] }) =>
  /deleted_at"\s+is not null/i.test(clause.sql) && /\bin \(/i.test(clause.sql);

describe.each(ROUTES.map(r => [r.module, r.idKey, r.perm, r.entity] as const))(
  '%s bulk restore (#3154)',
  (module, idKey, perm, entity) => {
    it('a trashed id reaches the case instead of 404-ing at the live-only gate', async () => {
      // Call 0 is the live validation: empty, because a trashed row never survives it.
      setup([[], [{ id: TRASHED }]]);
      const res = await post(module, idKey, {}, ctxWith({ [perm]: true }));
      const said = await res.text();
      expect(res.status, said).toBe(200);
      expect(JSON.parse(said)).toMatchObject({ ok: true, affected: 1 });

      const restorable = wheres[1];
      expect(restorable.op).toBe('select');
      expect(restorable.sql).toContain(`"${entity}"."id" in`);
      expect(restorable.sql, restorable.sql).toMatch(/is not null/i);
      expect(restorable.params).toContain(TRASHED);
    });

    it('the update is written over the restorable set, not over validIds', async () => {
      setup([[], [{ id: TRASHED }]]);
      const res = await post(module, idKey, {}, ctxWith({ [perm]: true }));
      const said = await res.text();
      expect(res.status, said).toBe(200);

      const update = wheres.find(w => w.op === 'update');
      expect(update, 'no update was rendered').toBeDefined();
      expect(readsTheTrashedSet(update!)).toBe(true);
      expect(update!.params).toContain(TRASHED);
      expect(updatePatch).toMatchObject({ deletedAt: null, deletedBy: null });
    });

    it('nothing trashed matched, so nothing is reported as restored', async () => {
      setup([[], []]);
      const res = await post(module, idKey, {}, ctxWith({ [perm]: true }));
      const said = await res.text();
      expect(res.status, said).toBe(404);
      expect(said).toContain('No deleted');
      expect(wheres.some(w => w.op === 'update')).toBe(false);
    });

    it('the exemption is for `restore` only — another action still 404s on an empty set', async () => {
      setup([[], []]);
      const res = await post(module, idKey, { action: 'archive' }, ctxWith({ [perm]: true }));
      const said = await res.text();
      expect(res.status, said).toBe(404);
      expect(said).toContain('No valid');
      // One validation query, then the bail: no second resolution for a verb that
      // does not target the tombstone.
      expect(wheres.filter(w => w.op === 'select')).toHaveLength(1);
    });

    it('the role without the entity permission is refused before the restore runs', async () => {
      setup([[], [{ id: TRASHED }]]);
      const res = await post(module, idKey, {}, ctxWith({}));
      const said = await res.text();
      expect(res.status, said).toBe(403);
      expect(said).toContain(perm);
      expect(wheres.some(w => w.op === 'update')).toBe(false);
    });
  },
);

describe('the second set is narrowed by the owner rule, where the entity has one (#3154)', () => {
  it('a task restore only ever reaches tasks the caller owns', async () => {
    setup([[], [{ id: TRASHED }]]);
    await post('tasks', 'task_ids', {}, ctxWith({ 'tasks.edit': true }));
    const restorable = wheres[1];
    expect(restorable.sql).toMatch(/"tasks"\."assigned_to".*=.*or.*"tasks"\."created_by".*=/);
    expect(restorable.params.filter(p => p === MINE)).toHaveLength(2);
  });

  it('a tasks.view_all holder keeps the tenant-wide restore', async () => {
    setup([[], [{ id: TRASHED }]]);
    await post('tasks', 'task_ids', {}, ctxWith({ 'tasks.edit': true, 'tasks.view_all': true }));
    expect(wheres[1].sql).not.toMatch(/"tasks"\."created_by"/);
    expect(wheres[1].params).toEqual([TRASHED, TENANT]);
  });

  it('companies has no owner scope to carry, by the #2597 decision', async () => {
    // Documented rather than invented here: `companies.view_all` is defined
    // (definitions.ts:43) and enforced in no companies route at all, so the restore
    // matches the rest of that route. If #2597 ever lands, this assertion is the one
    // that has to change — pinned on purpose, not by accident.
    setup([[], [{ id: TRASHED }]]);
    await post('companies', 'company_ids', {}, ctxWith({ 'companies.edit': true }));
    expect(wheres[1].sql).not.toMatch(/"companies"\."assigned_to"/);
    expect(readsTheTrashedSet(wheres[1])).toBe(true);
  });
});
