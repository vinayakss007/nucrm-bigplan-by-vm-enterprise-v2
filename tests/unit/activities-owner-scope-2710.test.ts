/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2710 — the activity feed had no owner rule, because it has no owner column.
 *
 * `GET /api/tenant/activities` built its WHERE from one predicate
 * (`activities.tenantId`), so every signed-in user read every other user's
 * complete timeline — who they worked on, what was done, when, and the record
 * ids it happened to. `POST` validated the shape of the body and stamped
 * whatever `entity_id` arrived: no existence check, no owner rule, no
 * permission.
 *
 * `activities` carries the polymorphic `entity_type`/`entity_id` pair
 * (`drizzle/schema/activity.ts:16-17`) and no `assigned_to`, so
 * `ownerScope()` has nothing to point at on the feed itself. The answer this
 * route takes is to borrow the rule of the record a request names — and to fall
 * back to the actor, whose index (`idx_activities_user`) already exists, when a
 * request names nothing.
 *
 * The mock db is not canned: it renders each predicate and answers it the way
 * Postgres would, by the relation it names, the tenant and entity it binds, and
 * whether it narrows to the caller. Red against `main`, not red because a call
 * was missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ELSEWHERE = '44444444-4444-4444-8444-444444444444';

const DEAL_MINE = '55555555-5555-4555-8555-555555555555';
const DEAL_OTHER = '66666666-6666-4666-8666-666666666666';
const DEAL_FOREIGN_TENANT = '77777777-7777-4777-8777-777777777777';
const CONTACT_MINE = '88888888-8888-4888-8888-888888888888';
const CONTACT_OTHER = '99999999-9999-4999-8999-999999999999';
const TASK_OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TICKET_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TICKET_FOREIGN_TENANT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const dialect = new PgDialect({} as never);

const OWNER_CLAUSE = /\("(contacts|deals|tasks)"\."assigned_to" = .* OR "\1"\."created_by" = /i;

type Q = { sql: string; params: unknown[]; table: string };

type Record_ = {
  id: string; table: string; tenantId: string;
  assignedTo: string | null; createdBy: string | null;
};

type Feed = {
  id: string; userId: string; entityType: string; entityId: string;
  eventType: string; description: string;
};

let reads: Q[] = [];
let executed: Q[] = [];
let inserted: Record<string, unknown>[] = [];
let records: Record<string, Record_> = {};
let feed: Feed[] = [];

function render(predicate: unknown): Q {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[], table: '' };
}

/** The value a rendered predicate binds to a column, or undefined if it does not. */
function boundValue(query: Q, column: string): unknown {
  const m = new RegExp(`"${column}" = \\$(\\d+)`).exec(query.sql);
  return m ? query.params[Number(m[1]) - 1] : undefined;
}

function narrowed(query: Q) {
  return OWNER_CLAUSE.test(query.sql) && query.params.includes(MINE);
}

function answerRecord(query: Q): Record_[] {
  const id = boundValue(query, 'id');
  const row = typeof id === 'string' ? records[id] : undefined;
  if (!row || row.table !== query.table) return [];
  if (row.tenantId !== TENANT) return [];
  if (boundValue(query, 'tenant_id') !== TENANT) return [];
  if (!narrowed(query)) return [row];
  return row.assignedTo === MINE || row.createdBy === MINE ? [row] : [];
}

function answerFeed(query: Q): Feed[] {
  if (boundValue(query, 'tenant_id') !== TENANT) return [];
  const actor = boundValue(query, 'user_id');
  const entityType = boundValue(query, 'entity_type');
  const entityId = boundValue(query, 'entity_id');
  const eventType = boundValue(query, 'event_type');
  return feed.filter((r) =>
    (actor === undefined || r.userId === actor)
    && (entityType === undefined || r.entityType === entityType)
    && (entityId === undefined || r.entityId === entityId)
    && (eventType === undefined || r.eventType === eventType));
}

function shape(rows: (Record_ | Feed)[], fields: Record<string, unknown> | undefined) {
  const keys = fields ? Object.keys(fields) : [];
  if (keys.includes('count')) return [{ count: rows.length }];
  if (keys.length === 1 && keys[0] === 'id') return rows.map((r) => ({ id: r.id }));
  return rows.map((r) => ({ ...(r as Feed), userName: 'Someone', createdAt: new Date('2026-10-01'), metadata: {} }));
}

/**
 * One builder per `db.select()`, holding its own relation and predicate: GET
 * awaits a count query and a list query, and the target gate runs a third, so
 * state shared across builders would answer the wrong question.
 */
function makeSelectBuilder(fields: Record<string, unknown> | undefined) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  let fromTable: string | undefined;
  let where: Q | undefined;
  builder['from'] = (table: object) => {
    fromTable = getTableName(table as never);
    return builder;
  };
  for (const m of ['leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit', 'offset']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    where = { ...render(predicate), table: fromTable as string };
    reads.push(where);
    return builder;
  };
  const resolve = () => {
    if (!where) return [];
    executed.push(where);
    const rows = where.table === 'activities' ? answerFeed(where) : answerRecord(where);
    return shape(rows, fields);
  };
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
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
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => body };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const activitiesRoute = await import('@/app/api/tenant/activities/route');

let body: Record<string, unknown> = {};

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep (definitions.ts:132-137): the edits, and the three CRM view_all
// rights explicitly false. No tickets.* grant.
const REP = {
  'contacts.create': true, 'contacts.edit': true, 'contacts.view_all': false,
  'leads.view': true, 'leads.edit': true, 'leads.view_all': false,
  'deals.view': true, 'deals.edit': true, 'deals.view_all': false,
  'tasks.create': true, 'tasks.edit': true,
  'companies.create': true, 'companies.edit': true,
};
// manager / viewer both hold the five view_all rights (definitions.ts:126,145).
const SEES_ALL = { ...REP, 'deals.view_all': true, 'contacts.view_all': true, 'leads.view_all': true, 'tasks.view_all': true, 'companies.view_all': true };
// A caller who may edit contacts and nothing else.
const CONTACTS_ONLY = { 'contacts.edit': true };

type Perms = Record<string, boolean>;

async function get(perms: Perms, query = '') {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(perms));
  const url = new URL(`http://localhost:3000/api/tenant/activities${query ? '?' + query : ''}`);
  const req = new NextRequest(url, { method: 'GET', headers: { 'x-forwarded-for': '127.0.0.1' } });
  return (activitiesRoute.GET as (req: NextRequest) => Promise<Response>)(req);
}

async function post(perms: Perms, payload: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(perms));
  body = payload;
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/activities'), {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' },
  });
  return (activitiesRoute.POST as (req: NextRequest) => Promise<Response>)(req);
}

const rec = (id: string, table: string, assignedTo: string | null, createdBy: string | null, tenantId = TENANT): Record_ =>
  ({ id, table, tenantId, assignedTo, createdBy });

const act = (id: string, userId: string, entityType: string, entityId: string, eventType = 'note'): Feed =>
  ({ id, userId, entityType, entityId, eventType, description: `${entityType} entry ${id}` });

/** Reads the body once, and asserts the 200 that goes with it. */
async function ids(res: Response) {
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return ((JSON.parse(text).data as { id: string }[] | undefined) ?? []).map((r) => r.id).sort();
}

beforeEach(() => {
  reads = [];
  executed = [];
  inserted = [];
  body = {};
  mockDb.select.mockImplementation((fields?: Record<string, unknown>) => makeSelectBuilder(fields));
  mockDb.insert.mockImplementation(() => ({
    values: (v: Record<string, unknown>) => ({
      returning: () => { inserted.push(v); return Promise.resolve([{ id: 'new-activity', ...v }]); },
    }),
  }));
  records = {
    [DEAL_MINE]: rec(DEAL_MINE, 'deals', MINE, MINE),
    [DEAL_OTHER]: rec(DEAL_OTHER, 'deals', OTHER, OTHER),
    [DEAL_FOREIGN_TENANT]: rec(DEAL_FOREIGN_TENANT, 'deals', MINE, MINE, ELSEWHERE),
    [CONTACT_MINE]: rec(CONTACT_MINE, 'contacts', MINE, OTHER),
    [CONTACT_OTHER]: rec(CONTACT_OTHER, 'contacts', OTHER, OTHER),
    [TASK_OTHER]: rec(TASK_OTHER, 'tasks', OTHER, OTHER),
    [COMPANY_OTHER]: rec(COMPANY_OTHER, 'companies', OTHER, OTHER),
    [TICKET_OTHER]: rec(TICKET_OTHER, 'support_tickets', OTHER, OTHER),
    [TICKET_FOREIGN_TENANT]: rec(TICKET_FOREIGN_TENANT, 'support_tickets', OTHER, OTHER, ELSEWHERE),
  };
  feed = [
    act('a1', MINE, 'deal', DEAL_MINE),
    act('a2', OTHER, 'deal', DEAL_MINE),
    act('a3', OTHER, 'deal', DEAL_OTHER),
    act('a4', MINE, 'contact', CONTACT_OTHER),
    act('a5', OTHER, 'company', COMPANY_OTHER),
    act('a6', OTHER, 'ticket', TICKET_OTHER),
  ];
});

describe('the unfiltered feed answers for the actor unless the caller reads all records (#2710)', () => {
  it('a rep gets their own trail, not the tenant\'s', async () => {
    const res = await get(REP);
    expect(await ids(res)).toEqual(['a1', 'a4']);
  });

  it('the feed query states the actor next to the tenant', async () => {
    await get(REP);
    const feedReads = executed.filter((q) => q.table === 'activities');
    expect(feedReads.length).toBeGreaterThan(0);
    for (const q of feedReads) {
      expect(q.sql).toMatch(/"activities"\."user_id"/);
      expect(q.params).toContain(MINE);
      expect(q.sql).toMatch(/"activities"\."tenant_id"/);
      expect(q.params).toContain(TENANT);
    }
  });

  it('the count the page paginates on is the narrowed count', async () => {
    const res = await get(REP);
    const json = await res.json();
    expect(json.total).toBe(2);
  });

  it('a view_all holder reads the tenant and asks nothing about the actor', async () => {
    const res = await get(SEES_ALL);
    expect(await ids(res)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    for (const q of executed.filter((r) => r.table === 'activities')) {
      expect(q.sql).not.toMatch(/"activities"\."user_id"/);
      expect(q.params).not.toContain(MINE);
    }
  });

  it('event_type still filters, for both callers', async () => {
    const res = await get(REP, 'event_type=call');
    expect(res.status).toBe(200);
    expect(await ids(res)).toEqual([]);
    const q = executed.find((r) => r.table === 'activities')!;
    expect(q.sql).toMatch(/"activities"\."event_type"/);
    expect(q.sql).toMatch(/"activities"\."user_id"/);
  });
});

describe('a named record is gated by its own rule (#2710)', () => {
  it('a rep cannot read the timeline of a deal they cannot open', async () => {
    const res = await get(REP, `deal_id=${DEAL_OTHER}`);
    expect(res.status).toBe(404);
    expect(executed.filter((q) => q.table === 'activities')).toHaveLength(0);
  });

  it('and neither a contact nor a task', async () => {
    expect((await get(REP, `contact_id=${CONTACT_OTHER}`)).status).toBe(404);
    expect((await get(REP, `task_id=${TASK_OTHER}`)).status).toBe(404);
    expect(executed.filter((q) => q.table === 'activities')).toHaveLength(0);
  });

  it('the gate asks the entity\'s own owner rule', async () => {
    await get(REP, `deal_id=${DEAL_OTHER}`);
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('deals');
    expect(reads[0].sql).toMatch(OWNER_CLAUSE);
    expect(reads[0].params).toContain(TENANT);
  });

  it('a record the caller owns still shows every actor\'s entry — the trail is the point', async () => {
    const res = await get(REP, `deal_id=${DEAL_MINE}`);
    expect(await ids(res)).toEqual(['a1', 'a2']);
    const q = executed.find((r) => r.table === 'activities')!;
    expect(q.sql).not.toMatch(/"activities"\."user_id"/);
    expect(boundValue(q, 'entity_type')).toBe('deal');
    expect(boundValue(q, 'entity_id')).toBe(DEAL_MINE);
  });

  it('a manager reads a foreign deal\'s trail, because the deal route lets them open it', async () => {
    const res = await get(SEES_ALL, `deal_id=${DEAL_OTHER}`);
    expect(await ids(res)).toEqual(['a3']);
    const gate = reads[0];
    expect(gate.table).toBe('deals');
    expect(gate.sql).not.toMatch(OWNER_CLAUSE);
  });

  it('a record in another tenant is a 404, not an answer', async () => {
    expect((await get(SEES_ALL, `deal_id=${DEAL_FOREIGN_TENANT}`)).status).toBe(404);
    expect((await get(REP, `ticket_id=${TICKET_FOREIGN_TENANT}`)).status).toBe(404);
  });

  it('a malformed id is refused before anything is asked', async () => {
    const res = await get(REP, 'deal_id=123');
    expect(res.status).toBe(404);
    expect(reads).toHaveLength(0);
  });

  it('the id source #2709 describes is closed: a foreign id yields no rows and no ok', async () => {
    const res = await get(REP, `deal_id=${DEAL_OTHER}`);
    const json = await res.json();
    expect(json.data).toBeUndefined();
  });
});

describe('company and ticket timelines stay tenant-wide, and the gap is said out loud (#2710 / #2597)', () => {
  it('companies.view_all is defined and enforced nowhere, so a rep still reads a foreign company\'s trail', async () => {
    const res = await get(REP, `company_id=${COMPANY_OTHER}`);
    expect(await ids(res)).toEqual(['a5']);
    const gate = reads[0];
    expect(gate.table).toBe('companies');
    expect(gate.sql).not.toMatch(/"companies"\."assigned_to"/);
    expect(gate.params).toContain(TENANT);
  });

  it('there is no tickets.view_all in the catalogue, so a ticket trail stays tenant-wide too', async () => {
    const res = await get(REP, `ticket_id=${TICKET_OTHER}`);
    expect(await ids(res)).toEqual(['a6']);
    expect(reads[0].table).toBe('support_tickets');
    expect(reads[0].sql).not.toMatch(/"support_tickets"\."assigned_to"/);
  });

  it('but a rep cannot use the company gap to read the unfiltered feed', async () => {
    const res = await get(REP);
    expect(await ids(res)).toEqual(['a1', 'a4']);
  });
});

describe('a write names a record it may edit (#2710)', () => {
  it('a rep cannot forge an entry onto a foreign deal', async () => {
    const res = await post(REP, { type: 'call', description: 'left a voicemail', deal_id: DEAL_OTHER });
    expect(res.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it('the forgery gate asks the deal\'s own owner rule', async () => {
    await post(REP, { type: 'call', description: 'left a voicemail', deal_id: DEAL_OTHER });
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('deals');
    expect(reads[0].sql).toMatch(OWNER_CLAUSE);
  });

  it('their own deal still takes the note, stamped to the row and the tenant', async () => {
    const res = await post(REP, { type: 'note', description: 'called back', deal_id: DEAL_MINE });
    expect(res.status, await res.text()).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      tenantId: TENANT, userId: MINE, entityType: 'deal', entityId: DEAL_MINE, eventType: 'note',
    });
  });

  it('the permission belongs to the record being written, not to whichever entity the route knew first', async () => {
    const res = await post(CONTACTS_ONLY, { type: 'call', description: 'x', deal_id: DEAL_MINE });
    expect(res.status).toBe(403);
    expect(reads).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('a caller with no edits at all cannot write onto a contact either', async () => {
    const res = await post({}, { type: 'call', description: 'x', contact_id: CONTACT_MINE });
    expect(res.status).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it('a contact the caller does not own is still a 404 behind the permission', async () => {
    const res = await post(REP, { type: 'call', description: 'x', contact_id: CONTACT_OTHER });
    expect(res.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it('a target-less entry stays open to any role, and is stamped to the caller', async () => {
    const res = await post({}, { type: 'note', description: 'just me' });
    expect(res.status, await res.text()).toBe(201);
    expect(inserted[0]).toMatchObject({ entityType: 'other', entityId: MINE, tenantId: TENANT });
    expect(reads).toHaveLength(0);
  });

  it('the body shape is still validated before any of it', async () => {
    expect((await post(REP, { description: 'no type', deal_id: DEAL_MINE })).status).toBe(400);
    expect((await post(REP, { type: 'call', description: 'not a uuid', deal_id: 'zzz' })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it('and a write onto a record in another tenant is a 404', async () => {
    expect((await post(REP, { type: 'call', description: 'x', deal_id: DEAL_FOREIGN_TENANT })).status).toBe(404);
    expect(inserted).toHaveLength(0);
  });
});

describe('the two queries the page runs agree (#2710)', () => {
  it('count and list carry the same predicate, so hasMore cannot lie', async () => {
    const res = await get(REP);
    const json = await res.json();
    const feedReads = executed.filter((q) => q.table === 'activities');
    expect(feedReads).toHaveLength(2);
    expect(feedReads[0].sql).toBe(feedReads[1].sql);
    expect(json.total).toBe((json.data as unknown[]).length);
    expect(json.hasMore).toBe(false);
  });

  it('a named target narrows the pair to that record, not to the actor', async () => {
    await get(SEES_ALL, `deal_id=${DEAL_OTHER}`);
    const feedReads = executed.filter((q) => q.table === 'activities');
    expect(feedReads).toHaveLength(2);
    for (const q of feedReads) {
      expect(boundValue(q, 'entity_id')).toBe(DEAL_OTHER);
      expect(boundValue(q, 'user_id')).toBeUndefined();
    }
  });
});
