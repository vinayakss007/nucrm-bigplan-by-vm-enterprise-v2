/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2752 — the lifecycle write reaches any contact in the workspace.
 *
 * `POST /api/tenant/contacts/[id]/lifecycle` (app/api/tenant/contacts/[id]/lifecycle/route.ts:21-84)
 * gates on `contacts.edit` (`:26`) and then resolves the row by
 * `id + tenant_id` only (`:56-58`) before calling
 * `SELECT public.update_contact_lifecycle(...)` (`:67`), which does
 * `UPDATE contacts SET lifecycle_stage = …` and inserts a history row
 * (drizzle/migrations/0032_missing_db_functions.sql:231-241).
 *
 * `sales_rep` holds `contacts.edit: true` with `contacts.view_all: false`
 * (lib/permissions/definitions.ts:132-133), and the entity's own rule — the one
 * `contacts/[id]` PATCH applies two routes away, at
 * `app/api/tenant/contacts/[id]/route.ts:195-200` — refuses that caller every row
 * they are neither `assigned_to` nor `created_by` on, with a 404. The existence
 * read here has no owner term, and no `deleted_at IS NULL` either, so a rep can
 * re-stage (and churn) a contact the same product answers 404 when they try to
 * read it, and record it in the lifecycle trail as their own doing.
 *
 * The reader below is not canned: it answers a contact only the way Postgres
 * would, from whether the statement the route actually rendered narrows to the
 * caller. So the route that never emits the owner predicate resolves the foreign
 * row and fails these assertions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DELETED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const dialect = new PgDialect({} as never);

const OWNER_CLAUSE = /\("contacts"\."assigned_to" = .* OR "contacts"\."created_by" = .*\)/i;

interface Row {
  id: string; tenantId: string; assignedTo: string | null; createdBy: string | null;
  deletedAt: Date | null; lifecycleStage: string; firstName: string;
}

let rows: Row[] = [];
let lastWhere: { sql: string; params: unknown[] } | undefined;
let executed: { sql: string; params: unknown[] }[] = [];
let body: Record<string, unknown> = {};

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/**
 * Postgres semantics for the existence read: a contact the caller does not own is
 * only returned when the statement asks for the caller's rows.
 */
function rowsFor(query: { sql: string; params: unknown[] } | undefined): Row[] {
  if (!query) return [];
  const named = rows.find(r => query.params.includes(r.id));
  if (!named) return [];
  if (!query.sql.includes('"contacts"."tenant_id"')) return [named];
  const tombstoned = /deleted_at/i.test(query.sql);
  if (tombstoned && named.deletedAt !== null) return [];
  const narrowed = OWNER_CLAUSE.test(query.sql)
    && query.params.filter(p => p === MINE).length >= 2;
  if (!narrowed) return [named];
  return named.assignedTo === MINE || named.createdBy === MINE ? [named] : [];
}

const mockDb: Record<string, unknown> = {
  query: {
    contacts: {
      findFirst: vi.fn((options?: { where?: unknown }) => {
        lastWhere = options && options.where !== undefined ? render(options.where) : undefined;
        return Promise.resolve(rowsFor(lastWhere)[0]);
      }),
    },
  },
  execute: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return { ...actual, readJsonBody: async () => body };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));

const { requireAuth } = await import('@/lib/auth/middleware');
const lifecycleRoute = await import('@/app/api/tenant/contacts/[id]/lifecycle/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: contacts.edit on, contacts.view_all off.
const REP = { 'contacts.view': true, 'contacts.edit': true };
const MANAGER = { ...REP, 'contacts.view_all': true };

async function post(ctx: AuthContext, id: string) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/contacts/${id}/lifecycle`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
  });
  return (lifecycleRoute.POST as (req: NextRequest, ctx?: unknown) => Promise<Response>)(
    req, { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  rows = [
    { id: OWNED, tenantId: TENANT, assignedTo: MINE, createdBy: MINE, deletedAt: null, lifecycleStage: 'lead', firstName: 'Mine' },
    { id: FOREIGN, tenantId: TENANT, assignedTo: OTHER, createdBy: OTHER, deletedAt: null, lifecycleStage: 'lead', firstName: 'Theirs' },
    { id: DELETED, tenantId: TENANT, assignedTo: MINE, createdBy: MINE, deletedAt: new Date(), lifecycleStage: 'lead', firstName: 'Gone' },
  ];
  lastWhere = undefined;
  executed = [];
  body = { lifecycle_stage: 'customer', reason: 'won the deal' };
  mockDb.execute.mockImplementation((fragment: unknown) => {
    executed.push(render(fragment));
    return Promise.resolve({ rows: [] });
  });
});

describe('a rep cannot re-stage a contact they do not own (#2752)', () => {
  it('a foreign contact is a 404 before the DB function runs', async () => {
    const res = await post(ctxWith(REP), FOREIGN);
    expect(res.status, await res.text()).toBe(404);
    expect(executed).toHaveLength(0);
  });

  it('the existence read narrows to the caller and pins the tombstone', async () => {
    await post(ctxWith(REP), FOREIGN);
    expect(lastWhere, 'the existence read never ran').toBeTruthy();
    expect(lastWhere!.sql, lastWhere!.sql).toMatch(OWNER_CLAUSE);
    expect(lastWhere!.params.filter(p => p === MINE)).toHaveLength(2);
    expect(lastWhere!.params).toContain(TENANT);
    expect(lastWhere!.sql).toMatch(/deleted_at/i);
  });

  it('a soft-deleted contact stays unreachable even to its owner', async () => {
    const res = await post(ctxWith(REP), DELETED);
    expect(res.status, await res.text()).toBe(404);
    expect(executed).toHaveLength(0);
  });

  it('the rep who owns the contact still re-stages it', async () => {
    const res = await post(ctxWith(REP), OWNED);
    // Read the body once: `res.text()` in an assertion message would consume it.
    const json = await res.json() as { data: { from_stage: string; to_stage: string } };
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(executed).toHaveLength(1);
    expect(json.data.from_stage).toBe('lead');
    expect(json.data.to_stage).toBe('customer');
  });

  it('the write targets the contact the read resolved', async () => {
    await post(ctxWith(REP), OWNED);
    // Deliberately mechanism-agnostic: the function this route calls is broken and
    // will be replaced by a transaction in a follow-up, and this assertion should
    // survive that without an edit.
    expect(executed[0]!.params).toContain(OWNED);
    expect(executed[0]!.params).not.toContain(FOREIGN);
  });
});

describe('a contacts.view_all holder re-stages any contact in the tenant (#2752)', () => {
  it('their existence read carries no owner predicate', async () => {
    const res = await post(ctxWith(MANAGER), FOREIGN);
    expect(res.status, await res.text()).toBe(200);
    expect(lastWhere!.sql, lastWhere!.sql).not.toMatch(OWNER_CLAUSE);
    expect(lastWhere!.params).not.toContain(MINE);
  });

  it('and the foreign row is written, as it always was', async () => {
    await post(ctxWith(MANAGER), FOREIGN);
    expect(executed).toHaveLength(1);
    expect(executed[0]!.params).toContain(FOREIGN);
  });
});
