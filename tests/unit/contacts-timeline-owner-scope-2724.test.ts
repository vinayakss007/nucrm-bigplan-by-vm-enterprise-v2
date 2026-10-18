/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2724 — the contact's two timeline routes never asked about the contact.
 *
 * `contacts/[id]` answers 404 for a `sales_rep`
 * (`lib/permissions/definitions.ts:132-137`) reaching a row that is neither
 * `assigned_to` nor `created_by` them, and `notes` POST applies the same rule
 * (#2698). The two reads in this pair did not: `notes` GET asked nothing at all,
 * and `timeline` GET asked `contacts.view_all || contacts.create` — a right to
 * make contacts, which says nothing about the row being read, and which
 * `sales_rep` holds. Both then returned the trail by `activities.contact_id`,
 * along with the note-writers' `user_email` and `user_avatar`.
 *
 * The mock db renders each predicate and answers it the way Postgres would — by
 * the relation it names, the tenant and contact it binds, and whether it narrows
 * to the caller — so these are red against `main`, not red because a call was
 * missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ELSEWHERE = '22222222-2222-4222-8222-222222222222';
const MINE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const CONTACT_MINE = '55555555-5555-4555-8555-555555555555';
const CONTACT_OTHER = '66666666-6666-4666-8666-666666666666';
const CONTACT_ELSEWHERE = '77777777-7777-4777-8777-777777777777';

const dialect = new PgDialect({} as never);

const OWNER_CLAUSE = /"contacts"\."assigned_to" = .* OR "contacts"\."created_by" = /i;

type Q = { sql: string; params: unknown[]; table: string };
type Contact = { id: string; tenantId: string; assignedTo: string | null; createdBy: string | null };
type Entry = { id: string; tenantId: string; contactId: string; userId: string; eventType: string; description: string };

let reads: Q[] = [];
let executed: Q[] = [];
let inserted: Record<string, unknown>[] = [];
let contacts_: Record<string, Contact> = {};
let entries: Entry[] = [];

function render(predicate: unknown, table: string): Q {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[], table };
}

function boundValue(query: Q, column: string): unknown {
  const m = new RegExp(`"${column}" = \\$(\\d+)`).exec(query.sql);
  return m ? query.params[Number(m[1]) - 1] : undefined;
}

function narrowed(query: Q) {
  return OWNER_CLAUSE.test(query.sql) && query.params.includes(MINE);
}

function answerContact(query: Q): Contact[] {
  const id = boundValue(query, 'id');
  const row = typeof id === 'string' ? contacts_[id] : undefined;
  if (!row || query.table !== 'contacts') return [];
  const tenant = boundValue(query, "tenant_id");
  if (tenant !== row.tenantId) return [];
  if (!narrowed(query)) return [row];
  return row.assignedTo === MINE || row.createdBy === MINE ? [row] : [];
}

function answerActivities(query: Q): Entry[] {
  if (query.table !== 'activities') return [];
  const tenant = boundValue(query, "tenant_id");
  if (tenant !== TENANT) return [];
  const contactId = boundValue(query, 'contact_id');
  const eventType = boundValue(query, 'event_type');
  return entries.filter((r) =>
    r.tenantId === tenant
    && (contactId === undefined || r.contactId === contactId)
    && (eventType === undefined || r.eventType === eventType));
}

function shape(rows: unknown[], fields: Record<string, unknown> | undefined) {
  const keys = fields ? Object.keys(fields) : [];
  if (keys.includes('total') || keys.includes('count')) return [{ total: rows.length, count: rows.length }];
  if (keys.length === 1 && keys[0] === 'id') return rows.map((r) => ({ id: (r as { id: string }).id }));
  return rows.map((r) => ({
    ...(r as Entry),
    event_type: (r as Entry).eventType,
    type: (r as Entry).eventType,
    user_email: 'colleague@corp.example',
    user_avatar: 'https://example/a.png',
    full_name: 'Colleague',
    metadata: {},
  }));
}

/** One builder per `db.select()`: the gate read and the trail read must not share state. */
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
    where = render(predicate, fromTable as string);
    reads.push(where);
    return builder;
  };
  const resolve = () => {
    if (!where) return [];
    executed.push(where);
    return shape(where.table === 'contacts' ? answerContact(where) : answerActivities(where), fields);
  };
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(resolve()).then(done);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(), query: { contacts: { findFirst: vi.fn() } },
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
vi.mock('@/lib/notifications', () => ({ processMentions: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/validate')>();
  return { ...actual, readJsonBody: async () => body };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const timeline = await import('@/app/api/tenant/contacts/[id]/timeline/route');
const notes = await import('@/app/api/tenant/contacts/[id]/notes/route');

let body: Record<string, unknown> = {};

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: creates and edits contacts, and its contacts.view_all is explicitly
// false (definitions.ts:133) — the role the coarse gate let through.
const REP = {
  'contacts.create': true, 'contacts.edit': true, 'contacts.view_all': false,
  'deals.view': true, 'tasks.create': true,
};
const SEES_ALL = { ...REP, 'contacts.view_all': true };
const CREATE_ONLY = { 'contacts.create': true };
const EDIT_ONLY = { 'contacts.edit': true };

type Perms = Record<string, boolean>;

function request(method: string, url: string, withBody = false) {
  return new NextRequest(new URL(url), {
    method,
    headers: withBody
      ? { 'x-forwarded-for': '127.0.0.1', 'content-type': 'application/json' }
      : { 'x-forwarded-for': '127.0.0.1' },
  });
}

type Verb = 'GET' | 'POST';

async function call(
  route: Record<string, unknown>, verb: Verb, path: string, perms: Perms, payload?: Record<string, unknown>,
) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(perms));
  body = payload ?? {};
  const sub = path.slice(0, path.indexOf('/'));
  const [id, query] = path.slice(path.indexOf('/') + 1).split('?');
  const url = `http://localhost:3000/api/tenant/contacts/${id}/${sub}${query ? '?' + query : ''}`;
  const handler = route[verb] as (
    req: NextRequest, ctx: { params: Promise<{ id: string }> }
  ) => Promise<Response>;
  return handler(request(verb, url, verb === 'POST'), { params: Promise.resolve({ id }) });
}

/** Reads the body once, and asserts the 200 that goes with it. */
async function ids(res: Response) {
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return ((JSON.parse(text).data as { id: string }[] | undefined) ?? []).map((r) => r.id).sort();
}

const contact = (id: string, assignedTo: string | null, createdBy: string | null, tenantId = TENANT): Contact =>
  ({ id, tenantId, assignedTo, createdBy });

const entry = (id: string, contactId: string, userId: string, eventType = 'note', tenantId = TENANT): Entry =>
  ({ id, tenantId, contactId, userId, eventType, description: `${eventType} on ${contactId.slice(0, 4)}` });

beforeEach(() => {
  reads = [];
  executed = [];
  inserted = [];
  body = {};
  mockDb.select.mockImplementation((fields?: Record<string, unknown>) => makeSelectBuilder(fields));
  mockDb.insert.mockImplementation(() => ({
    values: (v: Record<string, unknown>) => ({
      returning: () => { inserted.push(v); return Promise.resolve([{ id: 'new-entry', ...v }]); },
    }),
  }));
  mockDb.update.mockImplementation(() => ({
    set: () => ({
      where: () => Object.assign(Promise.resolve({ rowCount: 1 }), { returning: () => Promise.resolve([{ id: 'x' }]) }),
    }),
  }));
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
  (mockDb.query.contacts.findFirst as ReturnType<typeof vi.fn>).mockReset();
  contacts_ = {
    [CONTACT_MINE]: contact(CONTACT_MINE, MINE, MINE),
    [CONTACT_OTHER]: contact(CONTACT_OTHER, OTHER, OTHER),
    [CONTACT_ELSEWHERE]: contact(CONTACT_ELSEWHERE, MINE, MINE, ELSEWHERE),
  };
  entries = [
    entry('e1', CONTACT_MINE, MINE),
    entry('e2', CONTACT_MINE, OTHER),
    entry('e3', CONTACT_OTHER, OTHER),
    entry('e4', CONTACT_OTHER, MINE, 'call'),
    entry('e5', CONTACT_ELSEWHERE, OTHER),
  ];
});

describe('notes GET asks the rule its own POST already asks (#2724)', () => {
  it('a rep cannot read a foreign contact\'s notes', async () => {
    const res = await call(notes, 'GET', `notes/${CONTACT_OTHER}`, REP);
    expect(res.status).toBe(404);
    expect(executed.filter((q) => q.table === 'activities')).toHaveLength(0);
  });

  it('the gate read asks the contact\'s own owner rule', async () => {
    await call(notes, 'GET', `notes/${CONTACT_OTHER}`, REP);
    expect(reads).toHaveLength(1);
    expect(reads[0].table).toBe('contacts');
    expect(reads[0].sql).toMatch(OWNER_CLAUSE);
    expect(reads[0].params).toContain(TENANT);
  });

  it('their own contact still returns every author\'s note', async () => {
    const res = await call(notes, 'GET', `notes/${CONTACT_MINE}`, REP);
    expect(await ids(res)).toEqual(['e1', 'e2']);
  });

  it('a view_all holder reads the tenant, and their SQL is unchanged', async () => {
    const res = await call(notes, 'GET', `notes/${CONTACT_OTHER}`, SEES_ALL);
    expect(await ids(res)).toEqual(['e3', 'e4']);
    expect(reads[0].sql).not.toMatch(OWNER_CLAUSE);
    expect(reads[0].params).not.toContain(MINE);
  });

  it('a contact in another tenant is a 404, and its rows never surface', async () => {
    const res = await call(notes, 'GET', `notes/${CONTACT_ELSEWHERE}`, SEES_ALL);
    expect(res.status).toBe(404);
    const mine = await call(notes, 'GET', `notes/${CONTACT_MINE}`, SEES_ALL);
    expect(await ids(mine)).toEqual(['e1', 'e2']);
  });

  it('an id that cannot name a row is a 404 rather than a uuid cast error', async () => {
    const res = await call(notes, 'GET', 'notes/not-a-uuid', REP);
    expect(res.status).toBe(404);
    expect(reads).toHaveLength(0);
  });
});

describe('timeline GET replaces the create-or-view_all stand-in (#2724)', () => {
  it('a rep with contacts.create no longer reads any contact in the tenant', async () => {
    const res = await call(timeline, 'GET', `timeline/${CONTACT_OTHER}`, CREATE_ONLY);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain('colleague@corp.example');
  });

  it('and neither does a sales_rep, who holds both rights the gate asked for', async () => {
    expect((await call(timeline, 'GET', `timeline/${CONTACT_OTHER}`, REP)).status).toBe(404);
    expect(executed.filter((q) => q.table === 'activities')).toHaveLength(0);
  });

  it('their own contact still returns the whole trail, from every actor', async () => {
    const res = await call(timeline, 'GET', `timeline/${CONTACT_MINE}`, REP);
    expect(await ids(res)).toEqual(['e1', 'e2']);
    const trail = executed.find((q) => q.table === 'activities')!;
    expect(boundValue(trail, 'contact_id')).toBe(CONTACT_MINE);
    expect(trail.sql).not.toMatch(/"activities"\."user_id"/);
  });

  it('the gate read is the contact\'s rule, not a permission lookup', async () => {
    await call(timeline, 'GET', `timeline/${CONTACT_MINE}`, REP);
    expect(reads[0].table).toBe('contacts');
    expect(reads[0].sql).toMatch(OWNER_CLAUSE);
  });

  it('a view_all holder is untouched: no owner clause, and the tenant-wide trail', async () => {
    const res = await call(timeline, 'GET', `timeline/${CONTACT_OTHER}`, SEES_ALL);
    expect(await ids(res)).toEqual(['e3', 'e4']);
    expect(reads[0].sql).not.toMatch(OWNER_CLAUSE);
  });

  it('event_type still filters, and count and list agree', async () => {
    const res = await call(timeline, 'GET', `timeline/${CONTACT_MINE}?event_type=call`, REP);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const json = JSON.parse(text);
    expect(json.data).toHaveLength(0);
    expect(json.total).toBe(0);
    const trails = executed.filter((q) => q.table === 'activities');
    expect(trails).toHaveLength(2);
    expect(trails[0].sql).toBe(trails[1].sql);
  });

  it('an id that cannot name a row is a 404, not a 500', async () => {
    expect((await call(timeline, 'GET', 'timeline/not-a-uuid', SEES_ALL)).status).toBe(404);
    expect(reads).toHaveLength(0);
  });
});

describe('timeline POST keeps its permission and gains the row rule (#2724)', () => {
  const note = { content: 'called the contact', event_type: 'call' };

  it('a rep cannot write onto a colleague\'s contact', async () => {
    const res = await call(timeline, 'POST', `timeline/${CONTACT_OTHER}`, REP, note);
    expect(res.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it('their own contact still takes the entry, stamped to the row and the tenant', async () => {
    const res = await call(timeline, 'POST', `timeline/${CONTACT_MINE}`, REP, note);
    expect(res.status, await res.text()).toBe(201);
    expect(inserted[0]).toMatchObject({
      tenantId: TENANT, userId: MINE, contactId: CONTACT_MINE, eventType: 'call',
    });
  });

  it('the permission still comes first: no contacts.edit, no read at all', async () => {
    const res = await call(timeline, 'POST', `timeline/${CONTACT_MINE}`, CREATE_ONLY, note);
    expect(res.status).toBe(403);
    expect(reads).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('a missing event_type is still the 400 it was', async () => {
    const res = await call(timeline, 'POST', `timeline/${CONTACT_MINE}`, EDIT_ONLY, { content: 'x' });
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it('and a contact in another tenant is a 404 for a view_all holder', async () => {
    const res = await call(timeline, 'POST', `timeline/${CONTACT_ELSEWHERE}`, SEES_ALL, note);
    expect(res.status).toBe(404);
    expect(inserted).toHaveLength(0);
  });
});
