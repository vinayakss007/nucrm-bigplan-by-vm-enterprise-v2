/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2704 — Data Explorer was a tenant-wide CRUD panel for a `sales_rep`.
 *
 * `/tenant/data-explorer` browses and inline-edits five entities and is the only
 * route in that family speaking raw SQL on every verb. Every read was scoped by
 * tenant and tombstone only, so it returned rows that `contacts/[id]`,
 * `deals/[id]` and `tasks/[id]` refuse with a 404 (#2671, #2673, #2674, #2692,
 * #2698, #2701) — and PUT/DELETE wrote to them by id. PUT's stale-version
 * branch was worse than the leak it hid: the `SELECT 1` exists-check carried no
 * owner predicate either, so a foreign id answered **409 "this record was
 * modified by another user"**, confirming the row exists and telling the rep to
 * retry.
 *
 * `companies` is asserted *unscoped* on purpose. `companies.view_all` is defined
 * (`lib/permissions/definitions.ts:43`) and enforced nowhere (#2597), so this
 * route is not where an owner rule for companies gets invented — the test pins
 * the gap so closing it stays a visible decision rather than a silent one.
 *
 * No `<entity>.view` gate is asserted because there is nothing to gate on:
 * `contacts.view`, `companies.view` and `tasks.view` are not in the catalogue at
 * all, and `can()` is a strict lookup (`lib/auth/middleware.ts:432-435`), so
 * requiring them would answer 403 for the role that uses this tool most.
 *
 * The mocked `db.execute` is not canned: it answers a statement only the way
 * Postgres would, by reading the SQL the route actually rendered. A route that
 * never emits the owner predicate resolves and writes foreign ids, and fails
 * these assertions. `can()` is left real, because the rule under test *is* the
 * permission check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOREIGN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect({} as never);

// What each relation is called where the owner predicate has to appear: the
// alias in the five aliased reads, the table name in the un-aliased writes.
const ALIAS: Record<string, string> = {
  contacts: 'c', leads: 'l', deals: 'd', companies: 'co', tasks: 't',
};
// A field this route will accept for that entity (`EDITABLE_FIELDS`).
const EDITABLE: Record<string, string> = {
  contacts: 'first_name', leads: 'first_name', deals: 'title', companies: 'name', tasks: 'title',
};

/** drizzle renders `${sql.identifier(a)}.assigned_to` with the column as text. */
const ownerClause = (qualifier: string) =>
  new RegExp(`"${qualifier}"\\.assigned_to = .* or "${qualifier}"\\.created_by = `, 'i');

let calls: { sql: string; params: unknown[] }[] = [];
let owned: Set<string> = new Set();
let payload: Record<string, unknown> = {};

/**
 * Postgres semantics for this tenant: a statement qualified only by tenant
 * matches a foreign row; one that also carries `assigned_to = me OR created_by =
 * me` does not. The qualifier is read back out of the rendered SQL rather than
 * assumed, so the count query, the five data branches, the UPDATE and its
 * exists-check are all judged on what they actually asked for.
 */
function narrowed(q: { sql: string; params: unknown[] }) {
  return /"(\w+)"\.assigned_to/i.test(q.sql)
    && q.params.filter(p => p === MINE).length >= 2;
}

function answer(q: { sql: string; params: unknown[] }) {
  const text = q.sql.trim();
  const scoped = narrowed(q);
  const namedId = q.params.find(p => p === OWNED || p === FOREIGN) as string | undefined;
  const visible = !scoped || (namedId !== undefined && owned.has(namedId));

  if (/^SELECT count\(\*\)/i.test(text)) return [{ count: String(visible ? 1 : 0) }];
  if (/^SELECT 1/i.test(text)) return visible && namedId ? [{ '?column?': 1 }] : [];
  if (/^UPDATE/i.test(text)) return visible && namedId ? [{ id: namedId, title: 'edited' }] : [];
  return visible ? [{ id: FOREIGN, first_name: 'Foreign', last_name: 'Lead' }] : [];
}

const mockDb = { execute: vi.fn() };

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return { ...actual, readJsonBody: async () => payload };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/data-explorer/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: the four entity view_all flags are off (definitions.ts:132-137),
// and it holds the edit/delete grants these two verbs already require.
const REP = {
  'contacts.edit': true, 'leads.edit': true, 'deals.edit': true, 'tasks.edit': true, 'companies.edit': true,
  'contacts.delete': true, 'leads.delete': true, 'deals.delete': true, 'tasks.delete': true,
};
const MANAGER = {
  ...REP,
  'contacts.view_all': true, 'leads.view_all': true, 'deals.view_all': true,
  'companies.view_all': true, 'tasks.view_all': true,
};

beforeEach(() => {
  calls = [];
  owned = new Set();
  payload = {};
  mockDb.execute.mockImplementation((query: unknown) => {
    const q = dialect.sqlToQuery(query as never);
    const rendered = { sql: q.sql, params: q.params as unknown[] };
    calls.push(rendered);
    return Promise.resolve({ rows: answer(rendered) });
  });
});

async function callGet(ctx: AuthContext, params: Record<string, string>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const url = new URL('http://localhost:3000/api/tenant/data-explorer');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const req = new NextRequest(url, { method: 'GET', headers: { 'x-forwarded-for': '127.0.0.1' } });
  return (route.GET as (req: NextRequest) => Promise<Response>)(req);
}

async function callVerb(method: 'PUT' | 'DELETE', ctx: AuthContext, body: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  payload = body;
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/data-explorer'), {
    method,
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (route[method] as (req: NextRequest) => Promise<Response>)(req);
}

const counts = () => calls.filter(c => /^SELECT count\(\*\)/i.test(c.sql.trim()));
const dataReads = () => calls.filter(c => /^\s*SELECT (c|l|d|co|t)\./i.test(c.sql));
const updates = () => calls.filter(c => /^\s*UPDATE/i.test(c.sql));
const existsChecks = () => calls.filter(c => /^\s*SELECT 1/i.test(c.sql));

describe('a rep\'s browse narrows to their own rows (#2704)', () => {
  it.each(['contacts', 'leads', 'deals', 'tasks'] as const)('%s: the count and the read both carry the owner predicate', async type => {
    const res = await callGet(ctxWith(REP), { type });
    expect(res.status, await res.text()).toBe(200);
    expect(counts()).toHaveLength(1);
    expect(dataReads()).toHaveLength(1);
    for (const q of [...counts(), ...dataReads()]) {
      expect(q.sql, q.sql).toMatch(ownerClause(ALIAS[type]));
      expect(q.params.filter(p => p === MINE)).toHaveLength(2);
    }
  });

  it.each(['contacts', 'leads', 'deals', 'tasks'] as const)('%s: a foreign row is neither returned nor counted', async type => {
    const body = await (await callGet(ctxWith(REP), { type })).json();
    expect(body.data, type).toEqual([]);
    expect(body.total, type).toBe(0);
    expect(body.hasMore, type).toBe(false);
  });

  it.each(['contacts', 'leads', 'deals', 'tasks'] as const)('%s: tenant and tombstone predicates survive', async type => {
    await callGet(ctxWith(REP), { type });
    for (const q of [...counts(), ...dataReads()]) {
      expect(q.sql).toContain(`"${ALIAS[type]}".tenant_id`);
      expect(q.sql).toMatch(new RegExp(`"${ALIAS[type]}".deleted_at is null`, 'i'));
      expect(q.params).toContain(TENANT);
    }
  });

  it('the search and field filters keep the narrowing', async () => {
    await callGet(ctxWith(REP), { type: 'contacts', q: 'smith', field: 'email', value: 'a' });
    const q = dataReads()[0];
    expect(q.sql).toMatch(ownerClause('c'));
    expect(q.sql).toMatch(/ILIKE/i);
  });
});

describe('companies stay tenant-only until their view_all rule exists (#2704)', () => {
  it('a rep still sees every company — the gap is asserted, not quietly closed', async () => {
    const res = await callGet(ctxWith(REP), { type: 'companies' });
    expect(res.status, await res.text()).toBe(200);
    expect(dataReads()[0].sql).not.toMatch(ownerClause('co'));
    expect(dataReads()[0].params).not.toContain(MINE);
  });

  it('the contact_count subselect states its tenant instead of standing on RLS alone', async () => {
    await callGet(ctxWith(REP), { type: 'companies' });
    const q = dataReads()[0];
    expect(q.sql, q.sql).toMatch(/FROM contacts cc[\s\S]*?cc\.tenant_id = \$\d+/i);
    expect(q.params).toContain(TENANT);
  });
});

describe('a rep cannot edit or delete a row they do not own (#2704)', () => {
  it.each(['contacts', 'leads', 'deals', 'tasks'] as const)('%s PUT: 404, and the UPDATE never matches', async table => {
    const res = await callVerb('PUT', ctxWith(REP), { table, id: FOREIGN, field: EDITABLE[table], value: 'renamed' });
    expect(res.status, await res.text()).toBe(404);
    const write = updates()[0];
    expect(write.sql, write.sql).toMatch(ownerClause(table));
    expect(write.params.filter(p => p === MINE)).toHaveLength(2);
  });

  it.each(['contacts', 'leads', 'deals', 'tasks'] as const)('%s DELETE: 404, and the soft-delete never matches', async table => {
    const res = await callVerb('DELETE', ctxWith(REP), { table, id: FOREIGN });
    expect(res.status, await res.text()).toBe(404);
    expect(updates()[0].sql).toMatch(/deleted_at = now\(\)/i);
    expect(updates()[0].sql).toMatch(ownerClause(table));
  });

  it('a foreign id with a version stamp answers 404, not 409 — and the exists-check narrows too', async () => {
    const res = await callVerb('PUT', ctxWith(REP), {
      table: 'contacts', id: FOREIGN, field: 'first_name', value: 'renamed',
      expectedUpdatedAt: '2026-10-16 09:52:19.079633+00',
    });
    expect(res.status, await res.text()).toBe(404);
    expect(existsChecks()).toHaveLength(1);
    expect(existsChecks()[0].sql).toMatch(ownerClause('contacts'));
  });

  it('the optimistic-concurrency term still rides along on the narrowed UPDATE', async () => {
    owned = new Set([OWNED]);
    await callVerb('PUT', ctxWith(REP), {
      table: 'contacts', id: OWNED, field: 'first_name', value: 'renamed',
      expectedUpdatedAt: '2026-10-16 09:52:19.079633+00',
    });
    const write = updates()[0];
    expect(write.sql).toMatch(/date_trunc\('millisecond', updated_at::timestamptz\)/i);
    expect(write.sql).toMatch(ownerClause('contacts'));
  });

  it('a row the caller owns still edits and deletes', async () => {
    owned = new Set([OWNED]);
    const put = await callVerb('PUT', ctxWith(REP), { table: 'contacts', id: OWNED, field: 'first_name', value: 'renamed' });
    expect(put.status, await put.text()).toBe(200);
    const del = await callVerb('DELETE', ctxWith(REP), { table: 'contacts', id: OWNED });
    expect(del.status, await del.text()).toBe(200);
  });

  it('companies keep the tenant-only write, for the same reason as the read', async () => {
    const res = await callVerb('PUT', ctxWith(REP), { table: 'companies', id: FOREIGN, field: 'name', value: 'renamed' });
    expect(res.status, await res.text()).toBe(200);
    expect(updates()[0].sql).not.toMatch(ownerClause('companies'));
  });
});

describe('a view_all holder is unaffected (#2704)', () => {
  it.each(['contacts', 'leads', 'deals', 'companies', 'tasks'] as const)('%s: browse SQL carries no owner predicate', async type => {
    const res = await callGet(ctxWith(MANAGER), { type });
    expect(res.status, await res.text()).toBe(200);
    for (const q of [...counts(), ...dataReads()]) {
      expect(q.sql).not.toMatch(ownerClause(ALIAS[type]));
      expect(q.params).not.toContain(MINE);
    }
  });

  it('a foreign row is still listed for them', async () => {
    const body = await (await callGet(ctxWith(MANAGER), { type: 'contacts' })).json();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it.each(['contacts', 'leads', 'deals', 'tasks'] as const)('%s: a foreign id writes for them', async table => {
    const res = await callVerb('PUT', ctxWith(MANAGER), { table, id: FOREIGN, field: EDITABLE[table], value: 'renamed' });
    expect(res.status, await res.text()).toBe(200);
  });
});
