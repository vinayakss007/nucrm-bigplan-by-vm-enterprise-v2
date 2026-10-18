/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2712 — the edit-history route reads the record's trail, not the record.
 *
 * `app/api/tenant/history/[entity]/route.ts` filtered on tenant, entity type and
 * entity id, and on nothing else, so a `sales_rep` whose `contacts.view_all` is
 * false (`lib/permissions/definitions.ts:133`) — and who therefore gets a 404
 * from `contacts/[id]` for a contact that is neither `assigned_to` nor
 * `created_by` them — could fetch
 * `/api/tenant/history/contact?entity_id=<that contact>` and receive every
 * `old_value` / `new_value` pair the contact has ever had, plus the editor's
 * name, email, IP address and user agent (`drizzle/schema/history.ts:17-32`).
 * With `?type=snapshots` the same call returns the whole row payload.
 *
 * The reader below is not canned: it answers a gate query the way Postgres
 * would, by looking at whether the SQL the route rendered narrows to the caller
 * and at which relation the id was looked up in. So a route that never emits the
 * owner predicate resolves foreign ids and fails these assertions, and the fixed
 * route passes them.
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
const DEAL_MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const dialect = new PgDialect({} as never);

/** The path param, the relation it names, and the `view_all` id for it. */
const TABLE_OF: Record<string, string> = {
  contact: 'contacts',
  lead: 'leads',
  deal: 'deals',
  task: 'tasks',
  company: 'companies',
};

const OWNER_CLAUSE = /\("(contacts|leads|deals|tasks|companies)"\."assigned_to" = .* OR "\1"\."created_by" = /i;

let gates: { sql: string; params: unknown[]; table: string }[] = [];
let lastWhere: { sql: string; params: unknown[]; table: string } | undefined;
let lastFrom: string | undefined;
let rows: Record<string, { table: string; assignedTo: string | null; createdBy: string | null; deletedAt: unknown }> = {};

const historyCalls: unknown[][] = [];
const snapshotCalls: unknown[][] = [];

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/**
 * Postgres semantics for the gate: a row is returned when it exists in the
 * relation the query names, its tenant matches, and — if the query asks for the
 * caller's rows — the caller owns it.
 */
function rowsFor(query: { sql: string; params: unknown[]; table: string } | undefined) {
  if (!query) return [];
  const named = Object.keys(rows).find((id) => query.params.includes(id));
  if (!named) return [];
  if (rows[named].table !== query.table) return [];
  if (!query.sql.includes(`"${query.table}"."tenant_id"`)) return [rows[named]];
  if (!query.params.includes(TENANT)) return [];
  const narrowed = OWNER_CLAUSE.test(query.sql) && query.params.filter((p) => p === MINE).length >= 2;
  if (!narrowed) return [rows[named]];
  const row = rows[named];
  return row.assignedTo === MINE || row.createdBy === MINE ? [row] : [];
}

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder['from'] = (table: object) => {
    lastFrom = getTableName(table as never);
    return builder;
  };
  for (const m of ['leftJoin', 'innerJoin', 'orderBy', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    lastWhere = { ...render(predicate), table: lastFrom as string };
    gates.push(lastWhere);
    return builder;
  };
  const resolve = () => rowsFor(lastWhere);
  builder['limit'] = () => Promise.resolve(resolve());
  builder['all'] = () => Promise.resolve(resolve());
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

const mockDb: Record<string, unknown> = { select: vi.fn(), execute: vi.fn() };

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
vi.mock('@/lib/history', () => ({
  getEntityHistory: (...args: unknown[]) => {
    historyCalls.push(args);
    return Promise.resolve([{ id: 'h1', fieldName: 'email', oldValue: 'a@x.co', newValue: 'b@x.co' }]);
  },
  getEntitySnapshots: (...args: unknown[]) => {
    snapshotCalls.push(args);
    return Promise.resolve([{ id: 's1', snapshotData: JSON.stringify({ first_name: 'Ada' }) }]);
  },
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const historyRoute = await import('@/app/api/tenant/history/[entity]/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: the three owner-narrowed view_all grants are explicitly false
// (definitions.ts:133-135) and tasks/companies carry no view grant at all.
const REP = {
  'contacts.create': true, 'contacts.edit': true, 'contacts.view_all': false,
  'leads.view': true, 'leads.edit': true, 'leads.view_all': false,
  'deals.view': true, 'deals.edit': true, 'deals.view_all': false,
  'tasks.create': true, 'tasks.edit': true,
  'companies.create': true, 'companies.edit': true,
};
const MANAGER = {
  ...REP,
  'contacts.view_all': true, 'leads.view_all': true, 'deals.view_all': true,
  'tasks.view_all': true, 'companies.view_all': true,
};

async function call(permissions: Record<string, boolean>, entity: string, entityId: string, query = '') {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(permissions));
  const url = new URL(`http://localhost:3000/api/tenant/history/${entity}${query ? '?' + query : ''}`);
  if (entityId) url.searchParams.set('entity_id', entityId);
  const req = new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  return (historyRoute.GET as (req: NextRequest, c: { params: Promise<{ entity: string }> }) => Promise<Response>)(
    req,
    { params: Promise.resolve({ entity }) },
  );
}

const changes = (id = CONTACT_OTHER) => call(REP, 'contact', id, 'type=changes');

beforeEach(() => {
  gates = [];
  lastWhere = undefined;
  lastFrom = undefined;
  historyCalls.length = 0;
  snapshotCalls.length = 0;
  mockDb.select.mockImplementation(() => makeSelectBuilder());
  rows = {
    [CONTACT_MINE]: { table: 'contacts', assignedTo: MINE, createdBy: OTHER, deletedAt: null },
    [CONTACT_OTHER]: { table: 'contacts', assignedTo: OTHER, createdBy: OTHER, deletedAt: null },
    [LEAD_OTHER]: { table: 'leads', assignedTo: OTHER, createdBy: OTHER, deletedAt: null },
    [DEAL_OTHER]: { table: 'deals', assignedTo: OTHER, createdBy: OTHER, deletedAt: null },
    [TASK_OTHER]: { table: 'tasks', assignedTo: OTHER, createdBy: OTHER, deletedAt: null },
    [DEAL_MINE]: { table: 'deals', assignedTo: MINE, createdBy: MINE, deletedAt: null },
    [COMPANY_OTHER]: { table: 'companies', assignedTo: OTHER, createdBy: OTHER, deletedAt: null },
  };
});

describe('a rep cannot read the history of a record they cannot open (#2712)', () => {
  for (const [entity, id] of [
    ['contact', CONTACT_OTHER],
    ['lead', LEAD_OTHER],
    ['deal', DEAL_OTHER],
    ['task', TASK_OTHER],
  ] as const) {
    it(`${entity}: 404, and no trail is read`, async () => {
      const res = await call(REP, entity, id);
      expect(res.status, await res.text()).toBe(404);
      expect(historyCalls).toHaveLength(0);
    });

    it(`${entity}: the snapshots branch is gated too`, async () => {
      const res = await call(REP, entity, id, 'type=snapshots');
      expect(res.status, await res.text()).toBe(404);
      expect(snapshotCalls).toHaveLength(0);
    });

    it(`${entity}: the gate narrows to the caller and states its tenant`, async () => {
      await call(REP, entity, id);
      expect(gates.length, JSON.stringify(gates)).toBeGreaterThan(0);
      const gate = gates[0];
      expect(gate.sql).toMatch(OWNER_CLAUSE);
      expect(gate.params.filter((p) => p === MINE)).toHaveLength(2);
      expect(gate.params).toContain(TENANT);
    });
  }

  it('the refusal is a 404, so a foreign id is not confirmed', async () => {
    const res = await changes();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/assigned_to|created_by|owner/i);
  });

  it('the gate does not exclude soft-deleted rows', async () => {
    // A merged duplicate (#2702) and a trashed record keep their trail, and the
    // owner rule alone decides who reads it.
    rows[CONTACT_OTHER].deletedAt = new Date('2026-10-01T00:00:00Z');
    rows[CONTACT_MINE].deletedAt = new Date('2026-10-01T00:00:00Z');
    expect((await call(REP, 'contact', CONTACT_MINE)).status).toBe(200);
    const gate = gates[0];
    expect(gate.sql).not.toMatch(/deleted_at IS NULL/i);
    expect((await changes()).status).toBe(404);
  });
});

describe('a rep still reads their own records (#2712)', () => {
  it('their own contact returns the trail', async () => {
    const res = await call(REP, 'contact', CONTACT_MINE);
    expect(res.status).toBe(200);
    expect(historyCalls).toHaveLength(1);
    const body = await res.json();
    expect(body.data[0].fieldName).toBe('email');
  });

  it('it is asked for the tenant, the entity type and the id', async () => {
    await call(REP, 'deal', DEAL_MINE, 'limit=25');
    expect(historyCalls[0]).toEqual([TENANT, 'deal', DEAL_MINE, 25]);
  });

  it('snapshots parse for a row they own', async () => {
    const res = await call(REP, 'contact', CONTACT_MINE, 'type=snapshots');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].snapshotData).toEqual({ first_name: 'Ada' });
  });
});

describe('a view_all holder reads any trail in the tenant (#2712)', () => {
  for (const [entity, id] of [
    ['contact', CONTACT_OTHER],
    ['lead', LEAD_OTHER],
    ['deal', DEAL_OTHER],
    ['task', TASK_OTHER],
  ] as const) {
    it(`${entity}: their gate SQL carries no owner predicate`, async () => {
      const res = await call(MANAGER, entity, id);
      expect(res.status, await res.text()).toBe(200);
      const gate = gates[0];
      expect(gate.sql).not.toMatch(OWNER_CLAUSE);
      expect(gate.params).not.toContain(MINE);
      expect(gate.params).toContain(TENANT);
    });
  }
});

describe('the id is resolved in the relation the path names (#2712)', () => {
  it('a deal id under entity=contact does not return the deal trail', async () => {
    const res = await call(MANAGER, 'contact', DEAL_MINE);
    expect(res.status, await res.text()).toBe(404);
    expect(historyCalls).toHaveLength(0);
    expect(gates[0].table).toBe('contacts');
  });

  it('each entity consults its own table', async () => {
    for (const [entity, id] of [
      ['contact', CONTACT_OTHER],
      ['lead', LEAD_OTHER],
      ['deal', DEAL_OTHER],
      ['task', TASK_OTHER],
    ] as const) {
      gates = [];
      await call(MANAGER, entity, id);
      expect(gates[0].table).toBe(TABLE_OF[entity]);
    }
  });

  it('an unknown entity is still a 400, before any read', async () => {
    const res = await call(MANAGER, 'invoice', CONTACT_OTHER);
    expect(res.status, await res.text()).toBe(400);
    expect(gates).toHaveLength(0);
  });

  it('a missing entity_id is still a 400, before any read', async () => {
    const res = await call(MANAGER, 'contact', '');
    expect(res.status, await res.text()).toBe(400);
    expect(gates).toHaveLength(0);
  });
});

describe('companies stay tenant-only, because companies.view_all is enforced nowhere (#2712 / #2597)', () => {
  it('a rep reads a foreign company trail — the gate is the tenant, not the owner', async () => {
    const res = await call(REP, 'company', COMPANY_OTHER);
    expect(res.status, await res.text()).toBe(200);
    const gate = gates[0];
    expect(gate.sql).not.toMatch(OWNER_CLAUSE);
    expect(gate.params).toContain(TENANT);
  });

  it('a foreign tenant id still resolves to nothing', async () => {
    delete rows[COMPANY_OTHER];
    const res = await call(REP, 'company', COMPANY_OTHER);
    expect(res.status, await res.text()).toBe(404);
  });
});
