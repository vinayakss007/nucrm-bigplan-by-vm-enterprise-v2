/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2701 — `contacts/merge` is the most destructive write in the contacts family
 * and the only one with no owner rule.
 *
 * `contacts/[id]` answers 404 when the caller lacks `contacts.view_all` and the
 * row is neither `assigned_to` nor `created_by` them. Merge soft-deletes a
 * contact, moves its deals, activities, tasks, leads, follow-ups, record links
 * and scores onto another one, cancels its live drip enrollments and decrements
 * the tenant's plan counter — gated on `contacts.edit` alone. `sales_rep` holds
 * `contacts.edit: true` / `contacts.view_all: false`
 * (`lib/permissions/definitions.ts:132-133`), so that is a rep-level operation
 * over rows a rep cannot open.
 *
 * The reader below is not canned: it answers a contact only the way Postgres
 * would, by looking at whether the query the route actually rendered narrows to
 * the caller. So a route that never emits the owner predicate resolves foreign
 * ids and fails these assertions, and the fixed route passes them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRIMARY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DUPLICATE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect({} as never);

const OWNER_CLAUSE = /\("contacts"\."assigned_to" = .* OR "contacts"\."created_by" = .*\)/i;

let reads: { sql: string; params: unknown[] }[] = [];
let writes: { table: string; sql: string; params: unknown[] }[] = [];
let inserts: string[] = [];
let lastWhere: { sql: string; params: unknown[] } | undefined;
let owners: Record<string, { assignedTo: string | null; createdBy: string | null }> = {
  [PRIMARY]: { assignedTo: OTHER, createdBy: OTHER },
  [DUPLICATE]: { assignedTo: OTHER, createdBy: OTHER },
};
let body: Record<string, unknown> = {};

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/**
 * Postgres semantics for the two existence reads: a contact the caller does not
 * own is only returned once the query asks for the caller's rows.
 */
function rowsFor(query: { sql: string; params: unknown[] } | undefined) {
  if (!query) return [];
  const named = [PRIMARY, DUPLICATE].find((id) => query.params.includes(id));
  if (!named) return [];
  if (!query.sql.includes('"contacts"."tenant_id"')) return [contactRow(named)];
  const narrowed = OWNER_CLAUSE.test(query.sql) && query.params.filter((p) => p === MINE).length >= 2;
  if (!narrowed) return [contactRow(named)];
  const row = owners[named];
  return row.assignedTo === MINE || row.createdBy === MINE ? [contactRow(named)] : [];
}

function contactRow(id: string) {
  return {
    id,
    tenantId: TENANT,
    firstName: id === PRIMARY ? 'Primary' : 'Duplicate',
    lastName: 'Contact',
    tags: [],
    customFields: {},
    ...owners[id],
  };
}

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    lastWhere = render(predicate);
    reads.push(lastWhere);
    return builder;
  };
  const resolve = () => rowsFor(lastWhere);
  builder['limit'] = () => Promise.resolve(resolve());
  builder['all'] = () => Promise.resolve(resolve());
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

/** The junction read has no tenant column; it only has to not blow up. */
function makeTagBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'where', 'limit']) builder[m] = chain;
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve([]).then(done);
  return builder;
}

function makeWriter(table: string) {
  const writer: Record<string, unknown> = {};
  writer['set'] = () => writer;
  writer['values'] = () => writer;
  writer['onConflictDoNothing'] = () => Promise.resolve();
  writer['where'] = (predicate: unknown) => {
    const q = render(predicate);
    writes.push({ table, sql: q.sql, params: q.params });
    return Object.assign(Promise.resolve([]), {
      returning: () => Promise.resolve(table === 'contacts' ? [contactRow(PRIMARY)] : []),
    });
  };
  writer['returning'] = () => Promise.resolve([]);
  return writer;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
};

function makeTx() {
  // The only read inside the transaction is the junction lookup, whose table has
  // no tenant column to assert on.
  const table = (t: object) => getTableName(t);
  return {
    select: () => makeTagBuilder(),
    update: (t: object) => makeWriter(table(t)),
    delete: (t: object) => makeWriter(table(t)),
    insert: (t: object) => {
      const name = table(t);
      inserts.push(name);
      return makeWriter(name);
    },
  };
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/validate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/validate')>('@/lib/api/validate');
  return { ...actual, readJsonBody: async () => body };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/cron/sequence-steps', () => ({
  cancelOpenEnrollments: async () => ({ cancelled: 0, enrollmentIds: [] }),
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const mergeRoute = await import('@/app/api/tenant/contacts/merge/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: contacts.edit on, contacts.view_all off.
const REP = { 'contacts.view': true, 'contacts.edit': true };
const MANAGER = { ...REP, 'contacts.view_all': true };

async function call(ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/contacts/merge'), {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (mergeRoute.POST as (req: NextRequest) => Promise<Response>)(req);
}

const contactReads = () => reads.filter((r) => r.sql.includes('"contacts"."id"'));

beforeEach(() => {
  reads = [];
  writes = [];
  inserts = [];
  lastWhere = undefined;
  owners = {
    [PRIMARY]: { assignedTo: OTHER, createdBy: OTHER },
    [DUPLICATE]: { assignedTo: OTHER, createdBy: OTHER },
  };
  body = { primary_id: PRIMARY, duplicate_id: DUPLICATE };
  mockDb.select.mockImplementation(() => makeSelectBuilder());
  mockDb.update.mockImplementation(() => makeWriter('contacts'));
  mockDb.delete.mockImplementation(() => makeWriter('contacts'));
  mockDb.insert.mockImplementation(() => makeWriter('notes'));
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()));
});

describe('a rep cannot merge contacts they do not own (#2701)', () => {
  it('a foreign primary is refused before the transaction opens', async () => {
    const res = await call(ctxWith(REP));
    expect(res.status, await res.text()).toBe(404);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('a foreign duplicate is refused too — both ids must be the caller\'s', async () => {
    owners[PRIMARY] = { assignedTo: MINE, createdBy: MINE };
    const res = await call(ctxWith(REP));
    expect(res.status, await res.text()).toBe(404);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('the existence reads narrow to the caller', async () => {
    await call(ctxWith(REP));
    expect(contactReads()).toHaveLength(2);
    for (const read of contactReads()) {
      expect(read.sql).toMatch(OWNER_CLAUSE);
      expect(read.params.filter((p) => p === MINE)).toHaveLength(2);
      // The rule narrows the row; it does not replace the tenant or the tombstone.
      expect(read.params).toContain(TENANT);
      expect(read.sql).toMatch(/deleted_at/i);
    }
  });

  it('a rep who owns both contacts still merges', async () => {
    owners[PRIMARY] = { assignedTo: MINE, createdBy: OTHER };
    owners[DUPLICATE] = { assignedTo: OTHER, createdBy: MINE };
    const res = await call(ctxWith(REP));
    expect(res.status, await res.text()).toBe(200);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(writes.map((w) => w.table)).toContain('contacts');
    expect(inserts).toContain('contact_merge_history');
  });
});

describe('a contacts.view_all holder merges any two contacts in the tenant (#2701)', () => {
  it('their reads are unchanged — and() skips the scope', async () => {
    const res = await call(ctxWith(MANAGER));
    expect(res.status, await res.text()).toBe(200);
    for (const read of contactReads()) {
      expect(read.sql).not.toMatch(OWNER_CLAUSE);
      expect(read.params).not.toContain(MINE);
    }
  });

  it('foreign ids resolve for them', async () => {
    expect((await call(ctxWith(MANAGER))).status).toBe(200);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('the contact writes state the tenant they were gated on (#2701)', () => {
  it('every statement addressed by contacts.id is tenant-predicated', async () => {
    owners[PRIMARY] = { assignedTo: MINE, createdBy: MINE };
    owners[DUPLICATE] = { assignedTo: MINE, createdBy: MINE };
    await call(ctxWith(REP));
    const onContacts = writes.filter((w) => /"contacts"\."id"/.test(w.sql));
    expect(onContacts.length, JSON.stringify(writes.map((w) => w.sql))).toBe(3);
    for (const write of onContacts) {
      expect(write.sql, write.sql).toMatch(/"contacts"\."tenant_id"/);
      expect(write.params).toContain(TENANT);
    }
  });

  it('the nine related-record updates keep their own tenant predicates', async () => {
    owners[PRIMARY] = { assignedTo: MINE, createdBy: MINE };
    owners[DUPLICATE] = { assignedTo: MINE, createdBy: MINE };
    await call(ctxWith(REP));
    const related = writes.filter((w) => !"contacts".includes(w.table) && w.table !== 'tenants' && w.table !== 'contact_tags');
    expect(related.length).toBeGreaterThanOrEqual(9);
    for (const write of related) expect(write.params, write.sql).toContain(TENANT);
  });
});
