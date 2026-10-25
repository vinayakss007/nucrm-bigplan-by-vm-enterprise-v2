/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2673 — the contacts bulk route wrote rows its own detail handlers refuse.
 *
 * `contacts/[id]/route.ts` answers 404 to a caller without `contacts.view_all`
 * when the contact is not theirs (GET `:82-87`, PATCH `:195-200`, DELETE
 * `:304-311`), and the list narrows the same way through `canViewAll`
 * (`contacts/route.ts:28-30`). `contacts/bulk/route.ts` never mentioned
 * `view_all`: both of its id sets — the "select all matching" enumeration and the
 * explicit-id validation — were scoped by tenant, archive flag and tombstone only.
 *
 * Asserted on the SQL drizzle renders. A mocked `db` returns whatever it is told,
 * so a canned `{ affected: 1 }` passes with no ownership predicate anywhere, which
 * is exactly how this shipped.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let selectCall = 0;
let rowsPerCall: unknown[][] = [];
const mockDb = { select: vi.fn() };

function makeBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'offset', 'groupBy']) builder[m] = chain;
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
vi.mock('@/lib/audit', async (importOriginal) => ({
  // #3220: only the writer is faked — `bulkIdsAudit` is the shape under test,
  // so a mock that omits it turns every bulk route into a 500.
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  logAudit: vi.fn(),
}));
vi.mock('@/lib/dashboard/widget-cache', () => ({ invalidateWidgetCache: vi.fn() }));
vi.mock('@/lib/cron/sequence-steps', () => ({ cancelOpenEnrollments: vi.fn() }));
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
  const { POST } = await import('@/app/api/tenant/contacts/bulk/route');
  return POST(new NextRequest(new URL('/api/tenant/contacts/bulk', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  }));
}

// A rep without `contacts.view_all`: the role the [id] handlers answer 404 to.
const LIMITED = { 'contacts.view': true, 'contacts.edit': true, 'contacts.assign': true };
const BROAD = { ...LIMITED, 'contacts.view_all': true };

// `payload.assign_to` is left out on purpose: the handler stops at its own 400
// *after* both id sets have been resolved, so the SQL is captured without
// exercising a write.
const ownsBoth = (clause: { sql: string; params: unknown[] }) =>
  /"contacts"\."assigned_to".*=.*or.*"contacts"\."created_by".*=/.test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

describe('select-all matching is scoped to contacts the caller may touch (#2673)', () => {
  it('the tenant-wide enumeration becomes an owner-scoped one', async () => {
    setup([[{ id: CONTACT }], [{ id: CONTACT }]]);
    const res = await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(LIMITED));
    expect(res.status, await res.text()).toBe(400);

    const enumerated = wheres[0];
    expect(enumerated.sql).toContain('"contacts"."tenant_id"');
    expect(enumerated.sql).toMatch(/"contacts"\."deleted_at" is null/i);
    expect(ownsBoth(enumerated), `no ownership predicate: ${enumerated.sql}`).toBe(true);
  });

  it('keeps the narrowing when the caller filters on a company', async () => {
    setup([[{ id: CONTACT }], [{ id: CONTACT }]]);
    await post({ action: 'assign', selectAll: true, filters: { company_id: OTHER } }, ctxWith(LIMITED));
    // The caller's filter ANDs with the scope: it may narrow further, and naming
    // another owner cannot re-widen the set to the whole tenant.
    expect(ownsBoth(wheres[0])).toBe(true);
    expect(wheres[0].params).toContain(OTHER);
  });

  it('a user with contacts.view_all keeps the tenant-wide scope', async () => {
    setup([[{ id: CONTACT }], [{ id: CONTACT }]]);
    await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(BROAD));
    expect(wheres[0].sql).not.toMatch(/"contacts"\."created_by"/);
    expect(wheres[0].params).toEqual([TENANT, false]);
  });
});

describe('an explicit contact_ids list is validated against the same scope (#2673)', () => {
  it('the id validation refuses contacts the caller does not own', async () => {
    setup([[{ id: CONTACT }]]);
    const res = await post({ action: 'assign', ids: [CONTACT], updates: {} }, ctxWith(LIMITED));
    expect(res.status, await res.text()).toBe(400);
    expect(wheres).toHaveLength(1);
    expect(wheres[0].sql).toContain('"contacts"."id" in');
    expect(ownsBoth(wheres[0]), `no ownership predicate: ${wheres[0].sql}`).toBe(true);
  });

  it('both id sets narrow in selectAll mode, not just one', async () => {
    // One unguarded path is enough: `selectAll` resolves ids, and the validation
    // query decides which of them are written.
    setup([[{ id: CONTACT }], [{ id: CONTACT }]]);
    await post({ action: 'assign', selectAll: true, filters: {} }, ctxWith(LIMITED));
    expect(wheres).toHaveLength(2);
    expect(wheres.every(ownsBoth)).toBe(true);
  });

  it('a request for foreign contacts only is a 404, not a silent zero-effect write', async () => {
    // The narrowing is not decorative: the enumeration finds the row, the scoped
    // validation drops it, and the route's existing error shape reports it.
    setup([[{ id: CONTACT }], []]);
    const res = await post({ action: 'delete', selectAll: true, filters: {} }, ctxWith(LIMITED));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('No valid contacts found');
  });
});
