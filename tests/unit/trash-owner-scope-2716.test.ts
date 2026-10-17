/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2716 — Trash is one route over six entities, and neither of its open verbs
 * knows about ownership.
 *
 * GET asked for `requireAuth` and nothing else, then ran six queries whose whole
 * predicate was `tenant_id + deleted_at IS NOT NULL`, so any signed-in user read
 * every soft-deleted contact, lead, deal, task, company and project in the
 * tenant — name, email, status, who deleted it, and how many days are left
 * before the purge. PATCH asked `contacts.edit` for all six types and then
 * restored any row by id, re-incrementing the tenant's plan counter in the same
 * transaction. Meanwhile `contacts/[id]:82-87` answers 404 for a `sales_rep`
 * (`lib/permissions/definitions.ts:133`) reaching a contact that is neither
 * `assigned_to` nor `created_by` them.
 *
 * The reader below is not canned: it answers a rendered query the way Postgres
 * would — by which relation it names, whether it states the tenant, and whether
 * it narrows to the caller. A route that never emits the owner predicate lists
 * and restores foreign rows and fails these assertions; the fixed route passes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const CONTACT_MINE = '44444444-4444-4444-8444-444444444444';
const CONTACT_OTHER = '55555555-5555-4555-8555-555555555555';
const LEAD_OTHER = '66666666-6666-4666-8666-666666666666';
const DEAL_OTHER = '77777777-7777-4777-8777-777777777777';
const TASK_OTHER = '88888888-8888-4888-8888-888888888888';
const COMPANY_OTHER = '99999999-9999-4999-8999-999999999999';
const PROJECT_OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEAL_MINE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const dialect = new PgDialect({} as never);

const RESOURCE: Record<string, string> = {
  contacts: 'contact', leads: 'lead', deals: 'deal', tasks: 'task',
  companies: 'company', projects: 'project',
};

const OWNER_CLAUSE = /\("(contacts|leads|deals|tasks)"\."assigned_to" = .* OR "\1"\."created_by" = /i;

type Fixture = {
  id: string; table: string; assignedTo: string | null; createdBy: string | null;
  name: string; email: string | null; extra: string | null;
  deletedAt: Date; deletedBy: string | null; updatedAt: Date;
};

let reads: { sql: string; params: unknown[]; table: string }[] = [];
let executed: { sql: string; params: unknown[]; table: string }[] = [];
let updates: { sql: string; params: unknown[]; table: string }[] = [];
let audits: unknown[] = [];
let rows: Record<string, Fixture> = {};
/** Force the guarded UPDATE to match nothing, to exercise the 409 path. */
let stale = false;

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/** Does this rendered query restrict the row to the caller? */
function narrowed(query: { sql: string; params: unknown[]; table: string }) {
  return OWNER_CLAUSE.test(query.sql) && query.params.filter((p) => p === MINE).length >= 2;
}

/**
 * Postgres semantics: the rows are there when the query names their relation,
 * states their tenant, and — if it asks for the caller's rows — the caller owns
 * them.
 *
 * A query that binds a row id (PATCH's pre-read, the restore itself) addresses
 * that one row; a query that does not (GET's six list queries) is a scan of the
 * whole relation, which is why the list could leak the tenant's trash.
 */
function matching(query: { sql: string; params: unknown[]; table: string } | undefined) {
  if (!query) return [];
  const named = Object.keys(rows).find((id) => query.params.includes(id));
  const candidates = named
    ? (rows[named].table === query.table ? [rows[named]] : [])
    : Object.values(rows).filter((r) => r.table === query.table);
  if (candidates.length === 0) return [];
  if (!query.sql.includes(`"${query.table}"."tenant_id"`)) return candidates;
  if (!query.params.includes(TENANT)) return [];
  if (!narrowed(query)) return candidates;
  return candidates.filter((r) => r.assignedTo === MINE || r.createdBy === MINE);
}

function trashItem(row: Fixture) {
  return {
    resource_type: RESOURCE[row.table], id: row.id, tenant_id: TENANT,
    deleted_at: row.deletedAt, deleted_by: row.deletedBy,
    name: row.name, extra: row.extra, email: row.email, updatedAt: row.updatedAt,
  };
}

/**
 * Each `db.select()` gets its own builder with its own captured relation and
 * predicate. GET builds all six queries before it awaits any of them, so state
 * held at module scope would be overwritten by the last relation built
 * (`projects`) and every query would resolve against the wrong table.
 */
function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  let fromTable: string | undefined;
  let where: { sql: string; params: unknown[]; table: string } | undefined;
  builder['from'] = (table: object) => {
    fromTable = getTableName(table as never);
    return builder;
  };
  for (const m of ['leftJoin', 'innerJoin', 'orderBy', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    where = { ...render(predicate), table: fromTable as string };
    reads.push(where);
    return builder;
  };
  const resolve = () => {
    // GET builds all six queries before it awaits one of them, so `reads`
    // counts every predicate built; `executed` counts what actually ran.
    if (where) executed.push(where);
    return matching(where).map(trashItem);
  };
  builder['limit'] = () => Promise.resolve(resolve());
  builder['all'] = () => Promise.resolve(resolve());
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

function makeWriter(table: string) {
  const writer: Record<string, unknown> = {};
  writer['set'] = () => writer;
  writer['values'] = () => writer;
  writer['where'] = (predicate: unknown) => {
    const q = { ...render(predicate), table };
    updates.push(q);
    const hit = matching(q);
    const affected = hit.length && !stale ? hit.map((r) => ({ id: r.id })) : [];
    return Object.assign(Promise.resolve(Object.assign(affected, { rowCount: affected.length })), {
      returning: () => Promise.resolve(affected),
    });
  };
  writer['returning'] = () => Promise.resolve([]);
  return writer;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(), update: vi.fn(), delete: vi.fn(), insert: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined), tenantMeta: () => ({}) }));
vi.mock('@/lib/audit', () => ({
  logAudit: (entry: unknown) => { audits.push(entry); return Promise.resolve(); },
}));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => body };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const trashRoute = await import('@/app/api/tenant/trash/route');

let body: Record<string, unknown> = {};

function ctxWith(permissions: Record<string, boolean>, isAdmin = false): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: contacts/deals/leads/tasks/companies edit on, the three CRM
// view_all grants explicitly false (definitions.ts:133-135), tasks and
// companies carry no view grant.
const REP = {
  'contacts.create': true, 'contacts.edit': true, 'contacts.view_all': false,
  'leads.view': true, 'leads.edit': true, 'leads.view_all': false,
  'deals.view': true, 'deals.edit': true, 'deals.view_all': false,
  'tasks.create': true, 'tasks.edit': true,
  'companies.create': true, 'companies.edit': true,
};
// A caller who may edit contacts and nothing else.
const CONTACTS_ONLY = { 'contacts.edit': true };
const MANAGER = {
  ...REP,
  'contacts.view_all': true, 'leads.view_all': true, 'deals.view_all': true,
  'tasks.view_all': true, 'companies.view_all': true,
};

type Perms = Record<string, boolean>;

async function get(perms: Perms, query = '', isAdmin = false) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(perms, isAdmin));
  const req = new NextRequest(new URL(`http://localhost:3000/api/tenant/trash${query ? '?' + query : ''}`), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (trashRoute.GET as (req: NextRequest) => Promise<Response>)(req);
}

async function patch(perms: Perms, payload: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(perms));
  body = payload;
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/trash'), {
    method: 'PATCH',
    headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
  });
  return (trashRoute.PATCH as (req: NextRequest) => Promise<Response>)(req);
}

async function del(perms: Perms, payload: Record<string, unknown>, isAdmin = false) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(perms, isAdmin));
  body = payload;
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/trash'), {
    method: 'DELETE',
    headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
  });
  return (trashRoute.DELETE as (req: NextRequest) => Promise<Response>)(req);
}

async function listedIds(perms: Perms, query = '') {
  const res = await get(perms, query);
  expect(res.status).toBe(200);
  const bodyJson = await res.json();
  return (bodyJson.data as { id: string }[]).map((i) => i.id).sort();
}

const fix = (id: string, table: string, assignedTo: string | null, createdBy: string | null): Fixture => ({
  id, table, assignedTo, createdBy,
  name: `${RESOURCE[table]} ${id.slice(0, 4)}`,
  email: table === 'contacts' ? `${id.slice(0, 4)}@x.co` : null,
  extra: null,
  deletedAt: new Date('2026-10-01T10:00:00Z'),
  deletedBy: OTHER,
  updatedAt: new Date('2026-10-02T10:00:00.500Z'),
});

beforeEach(() => {
  reads = [];
  executed = [];
  updates = [];
  audits = [];
  stale = false;
  body = {};
  mockDb.select.mockImplementation(() => makeSelectBuilder());
  mockDb.update.mockImplementation((t: object) => makeWriter(getTableName(t as never)));
  mockDb.delete.mockImplementation((t: object) => makeWriter(getTableName(t as never)));
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
  mockDb.execute.mockResolvedValue({ rows: [{ n: '0' }] });
  rows = {
    [CONTACT_MINE]: fix(CONTACT_MINE, 'contacts', MINE, OTHER),
    [CONTACT_OTHER]: fix(CONTACT_OTHER, 'contacts', OTHER, OTHER),
    [LEAD_OTHER]: fix(LEAD_OTHER, 'leads', OTHER, OTHER),
    [DEAL_OTHER]: fix(DEAL_OTHER, 'deals', OTHER, OTHER),
    [TASK_OTHER]: fix(TASK_OTHER, 'tasks', OTHER, OTHER),
    [DEAL_MINE]: fix(DEAL_MINE, 'deals', MINE, MINE),
    [COMPANY_OTHER]: fix(COMPANY_OTHER, 'companies', OTHER, OTHER),
    [PROJECT_OTHER]: fix(PROJECT_OTHER, 'projects', OTHER, OTHER),
  };
});

describe('a rep only sees their own deleted rows in the list (#2716)', () => {
  it('the unfiltered view hides every foreign row the entity rule scopes out', async () => {
    const seen = await listedIds(REP);
    // company and project are the two entities with nothing to scope on — see
    // the tenant-only group below.
    expect(seen).toEqual([CONTACT_MINE, DEAL_MINE, COMPANY_OTHER, PROJECT_OTHER].sort());
    for (const foreign of [CONTACT_OTHER, LEAD_OTHER, DEAL_OTHER, TASK_OTHER]) {
      expect(seen).not.toContain(foreign);
    }
  });

  it('the tombstone and the tenant still stand next to the owner clause', async () => {
    await get(REP);
    const contactRead = reads.find((r) => r.table === 'contacts');
    expect(contactRead!.sql).toMatch(OWNER_CLAUSE);
    expect(contactRead!.params.filter((p) => p === MINE)).toHaveLength(2);
    expect(contactRead!.params).toContain(TENANT);
    expect(contactRead!.sql).toMatch(/"deleted_at" is not null/i);
  });

  it('each scoped entity narrows to the caller', async () => {
    await get(REP);
    for (const table of ['contacts', 'leads', 'deals', 'tasks']) {
      const read = reads.find((r) => r.table === table);
      expect(read, `no read of ${table}`).toBeDefined();
      expect(read!.sql).toMatch(OWNER_CLAUSE);
    }
  });

  it('?type=contact asks one narrowed question', async () => {
    const seen = await listedIds(REP, 'type=contact');
    expect(seen).toEqual([CONTACT_MINE]);
    expect(executed).toHaveLength(1);
    expect(executed[0].table).toBe('contacts');
  });

  it('a foreign row is absent, not merely uncounted', async () => {
    const res = await get(REP, 'type=lead');
    const bodyJson = await res.json();
    expect(bodyJson.data).toHaveLength(0);
    expect(bodyJson.total).toBe(0);
  });
});

describe('a view_all holder still sees the tenant (#2716)', () => {
  it('their reads carry no owner predicate at all', async () => {
    await get(MANAGER);
    expect(reads.length).toBeGreaterThanOrEqual(6);
    for (const read of reads) {
      expect(read.sql).not.toMatch(OWNER_CLAUSE);
      expect(read.params).not.toContain(MINE);
    }
  });

  it('foreign deleted rows are theirs to see', async () => {
    const seen = await listedIds(MANAGER);
    for (const id of [CONTACT_OTHER, LEAD_OTHER, DEAL_OTHER, TASK_OTHER, COMPANY_OTHER, PROJECT_OTHER]) {
      expect(seen).toContain(id);
    }
  });
});

describe('a rep cannot restore a row they do not own (#2716)', () => {
  for (const [type, id] of [
    ['contact', CONTACT_OTHER], ['lead', LEAD_OTHER], ['deal', DEAL_OTHER], ['task', TASK_OTHER],
  ] as const) {
    it(`${type}: 404, nothing written, nothing audited`, async () => {
      const res = await patch(REP, { id, resource_type: type });
      expect(res.status).toBe(404);
      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
      expect(audits).toHaveLength(0);
    });

    it(`${type}: the pre-restore read narrows to the caller`, async () => {
      await patch(REP, { id, resource_type: type });
      expect(reads).toHaveLength(1);
      expect(reads[0].sql).toMatch(OWNER_CLAUSE);
      expect(reads[0].params).toContain(TENANT);
    });
  }

  it('the restore of their own row still works', async () => {
    const res = await patch(REP, { id: CONTACT_MINE, resource_type: 'contact' });
    expect(res.status).toBe(200);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(updates.map((u) => u.table)).toContain('contacts');
    expect(audits).toHaveLength(1);
  });

  it('the guarded UPDATE carries tenant, tombstone, owner and the concurrency stamp at once', async () => {
    await patch(REP, { id: CONTACT_MINE, resource_type: 'contact' });
    const write = updates.find((u) => u.table === 'contacts');
    expect(write!.sql).toMatch(/"contacts"\."tenant_id"/);
    expect(write!.sql).toMatch(/"deleted_at" is not null/i);
    expect(write!.sql).toMatch(OWNER_CLAUSE);
    expect(write!.sql).toMatch(/date_trunc\('millisecond'/i);
    expect(write!.sql).toMatch(/updated_at/i);
  });

  it('a stale write still answers 409 and leaves the counter alone', async () => {
    stale = true;
    const res = await patch(REP, { id: CONTACT_MINE, resource_type: 'contact' });
    expect(res.status).toBe(409);
    expect(updates.filter((u) => u.table === 'tenants')).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('restoring their own contact re-increments the tenant counter once', async () => {
    await patch(REP, { id: CONTACT_MINE, resource_type: 'contact' });
    const bumps = updates.filter((u) => u.table === 'tenants');
    expect(bumps).toHaveLength(1);
    expect(bumps[0].params).toContain(TENANT);
  });
});

describe('a restore asks the permission of the row being restored (#2716)', () => {
  it('contacts.edit alone no longer restores a deal', async () => {
    const res = await patch(CONTACTS_ONLY, { id: DEAL_MINE, resource_type: 'deal' });
    expect(res.status).toBe(403);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('and no longer restores a task, a company or a lead', async () => {
    for (const [type, id] of [
      ['task', TASK_OTHER], ['company', COMPANY_OTHER], ['lead', LEAD_OTHER],
    ] as const) {
      const res = await patch(CONTACTS_ONLY, { id, resource_type: type });
      expect(res.status, type).toBe(403);
    }
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('deals.edit does restore the rep\'s own deal', async () => {
    const res = await patch(REP, { id: DEAL_MINE, resource_type: 'deal' });
    expect(res.status).toBe(200);
    const bumps = updates.filter((u) => u.table === 'tenants');
    expect(bumps).toHaveLength(1);
  });

  it('an unknown resource_type is still a 400 before any read', async () => {
    const res = await patch(REP, { id: CONTACT_MINE, resource_type: 'invoice' });
    expect(res.status).toBe(400);
    expect(reads).toHaveLength(0);
  });

  it('a missing id is still a 400', async () => {
    expect((await patch(REP, { resource_type: 'contact' })).status).toBe(400);
    expect(reads).toHaveLength(0);
  });
});

describe('company and project stay tenant-only, and the gap is said out loud (#2716 / #2597)', () => {
  it('companies.view_all is defined and enforced nowhere, so a rep still lists foreign companies', async () => {
    const seen = await listedIds(REP, 'type=company');
    expect(seen).toEqual([COMPANY_OTHER]);
    const read = reads.find((r) => r.table === 'companies');
    expect(read!.sql).not.toMatch(/"companies"\."assigned_to"/);
    expect(read!.params).toContain(TENANT);
  });

  it('a rep with companies.edit restores a foreign company — the row rule projects nothing onto it', async () => {
    const res = await patch(REP, { id: COMPANY_OTHER, resource_type: 'company' });
    expect(res.status).toBe(200);
    const write = updates.find((u) => u.table === 'companies');
    expect(write!.sql).not.toMatch(/"companies"\."assigned_to"/);
  });

  it('projects have no permission id at all, so the restore keeps the gate this route already used', async () => {
    // There is no `projects.*` entry in the catalogue (#2597), so there is
    // nothing coherent to ask for and nothing to scope a read on —
    // `projects` has `owner_id`, not `assigned_to` (drizzle/schema/projects.ts:22).
    // Pinned as the residual gap: closing it is #2597's decision, not this fix's.
    const res = await patch(CONTACTS_ONLY, { id: PROJECT_OTHER, resource_type: 'project' });
    expect(res.status).toBe(200);
    const write = updates.find((u) => u.table === 'projects');
    expect(write!.sql).toMatch(/"projects"\."tenant_id"/);
    expect(write!.sql).not.toMatch(/"projects"\."created_by"/);
  });

  it('a foreign project still appears in the list, because there is no projects.view_all to ask', async () => {
    const seen = await listedIds(REP, 'type=project');
    expect(seen).toEqual([PROJECT_OTHER]);
  });
});

describe('the hard delete keeps the gate it already had (#2716)', () => {
  it('a non-admin is refused before anything is read', async () => {
    const res = await del(REP, { id: CONTACT_OTHER, resource_type: 'contact' });
    expect(res.status).toBe(403);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(updates.filter((u) => u.table === 'contacts')).toHaveLength(0);
  });

  it('a tenant admin still purges any row of their own tenant', async () => {
    const res = await del(REP, { id: CONTACT_OTHER, resource_type: 'contact' }, true);
    expect(res.status).toBe(200);
    const write = updates.find((u) => u.table === 'contacts');
    expect(write!.params).toContain(TENANT);
  });
});
