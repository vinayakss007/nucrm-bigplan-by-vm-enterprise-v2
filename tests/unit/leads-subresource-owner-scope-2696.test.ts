/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2696 — the lead owner rule stopped at `leads/[id]`.
 *
 * #2692 put `assigned_to = me OR created_by = me` (unless `leads.view_all`) on the
 * lead record path, matching what `contacts`, `deals` and `tasks` already answered
 * with a 404. Five surfaces kept taking any lead id in the tenant on tenant +
 * tombstone alone, and three of them WRITE:
 *
 *   - `leads/[id]/assign` POST   — the handoff dialog (`lead-detail-client.tsx:197`)
 *   - `leads/[id]/convert` POST  — converts on the caller's behalf
 *                                (`lead-detail-client.tsx:155`); the lookup lives in
 *                                `lib/leads/convert.ts:76`, so the route had nothing
 *                                to check and the core had no scope to apply
 *   - `leads/assign` POST/DELETE — bulk assign/unassign of `contacts.assigned_to`
 *   - `leads/history` GET        — the tenant's whole assignment trail, names included
 *   - `contacts/[id]/leads` GET  — the contact's Leads tab (`contact-detail-client.tsx:302`),
 *                                budget/value/score/needDescription + offer totals; also
 *                                where #2692's bulk id set became readable
 *
 * Asserted on the SQL each route renders, the way #2686/#2690/#2692 are. The mock
 * answers a read the way Postgres would — a foreign row comes back only when the
 * query never asked for the caller — so the behaviour tests are red before the fix
 * instead of passing on a mocked row set. `can()` is left real: the rule under test
 * IS the permission check, and mocking the middleware would grade the mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEAD = '33333333-3333-4333-8333-333333333333';
const CONTACT = '44444444-4444-4444-8444-444444444444';
const dialect = new PgDialect({} as never);

/** What `ownerScope(ctx, '<entity>.view_all', <table>)` renders for a rep. */
function ownerClause(table: 'leads' | 'contacts') {
  return new RegExp(`\\("${table}"\\."assigned_to" = .* OR "${table}"\\."created_by" = .*\\)`, 'i');
}

let reads: { sql: string; params: unknown[] }[] = [];
let writes: { sql: string }[] = [];
let raws: { sql: string; params: unknown[] }[] = [];
let lastWhere: { sql: string; params: unknown[] } | undefined;

/** The row every lead read is about: owned and created by another rep by default. */
let leadRow: Record<string, unknown>;
/** The contact `leads/assign` and the contact Leads tab resolve. */
let contactRow: Record<string, unknown>;

const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
  query: {} as Record<string, { findFirst: ReturnType<typeof vi.fn> }>,
};

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params };
}

/** True when this rendered query narrowed rows to the calling user. */
function narrowedToCaller(q: { sql: string; params: unknown[] }, table: 'leads' | 'contacts') {
  return ownerClause(table).test(q.sql) && q.params.filter(p => p === MINE).length >= 2;
}

/**
 * The mock answers like the database would, per table: a row belonging to another
 * rep comes back only when the query never narrowed to the caller. `[]` for the
 * list shape; the `findFirst` shape takes the first element (so `undefined` for a
 * refusal, which is what turns into the route's 404).
 */
function rowsForQuery(q: { sql: string; params: unknown[] } | undefined) {
  const leadIsMine = leadRow.assignedTo === MINE || leadRow.createdBy === MINE;
  const contactIsMine = contactRow.assignedTo === MINE || contactRow.createdBy === MINE;
  const trailRow = {
    id: 'trail-1', leadId: LEAD, userId: OTHER, leadFirstName: 'Foreign', leadLastName: 'Lead',
  };
  if (!q) return [leadRow];
  if (q.sql.includes('"lead_offers"')) return [];
  if (q.sql.includes('"lead_assignments"."tenant_id"')) {
    return narrowedToCaller(q, 'leads') && !leadIsMine ? [] : [trailRow];
  }
  if (q.sql.includes('"contacts"."tenant_id"')) {
    return narrowedToCaller(q, 'contacts') && !contactIsMine ? [] : [contactRow];
  }
  return narrowedToCaller(q, 'leads') && !leadIsMine ? [] : [leadRow];
}

/** Awaitable result that also behaves like a drizzle builder — `.values()`, `.returning()`. */
function resultOf(rows: unknown) {
  const p = Promise.resolve(rows) as Promise<unknown> & Record<string, unknown>;
  p['returning'] = () => p;
  p['values'] = () => p;
  p['getSQL'] = () => '';
  return p;
}

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'having', 'returning']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    lastWhere = render(predicate);
    reads.push(lastWhere);
    return builder;
  };
  builder['limit'] = () => resultOf(rowsForQuery(lastWhere));
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rowsForQuery(lastWhere));
  return builder;
}

/** `db.update(t).set(...).where(...)` / `.delete(t).where(...)` — captures the SQL. */
function makeWriter() {
  const writer: Record<string, unknown> = {};
  writer['set'] = () => writer;
  writer['where'] = (predicate: unknown) => {
    writes.push(render(predicate));
    return resultOf([{ id: LEAD }]);
  };
  writer['then'] = (resolve: (v: unknown) => unknown) => resolve([{ id: LEAD }]);
  return writer;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: async (_ctx: unknown, _entity: string, rows: unknown[]) => rows,
  enforceFieldWrite: async (_ctx: unknown, _entity: string, body: unknown) => ({ body, stripped: [] }),
  attachStrippedFields: (res: Response) => res,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const { createNotification } = await import('@/lib/notifications');
const handoffRoute = await import('@/app/api/tenant/leads/[id]/assign/route');
const convertRoute = await import('@/app/api/tenant/leads/[id]/convert/route');
const bulkAssignRoute = await import('@/app/api/tenant/leads/assign/route');
const historyRoute = await import('@/app/api/tenant/leads/history/route');
const contactLeadsRoute = await import('@/app/api/tenant/contacts/[id]/leads/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep (lib/permissions/definitions.ts:132-144): the four record permissions
// on, `leads.view_all` / `contacts.view_all` off. `contacts.assign` is what the
// bulk assign route requires.
const REP = {
  'leads.view': true, 'leads.edit': true, 'leads.convert': true,
  'contacts.view': true, 'contacts.edit': true, 'contacts.assign': true,
};
const MANAGER = { ...REP, 'leads.view_all': true, 'contacts.view_all': true };

beforeEach(() => {
  reads = [];
  writes = [];
  raws = [];
  lastWhere = undefined;
  leadRow = { id: LEAD, assignedTo: OTHER, createdBy: OTHER, contactId: CONTACT, companyId: null };
  contactRow = { id: CONTACT, assignedTo: OTHER, createdBy: OTHER };
  mockDb.select.mockImplementation(() => makeBuilder());
  mockDb.update.mockImplementation(() => makeWriter());
  mockDb.delete.mockImplementation(() => makeWriter());
  mockDb.insert.mockImplementation(() => resultOf([{ id: CONTACT }]));
  mockDb.execute.mockImplementation((fragment: unknown) => {
    raws.push(render(fragment));
    return resultOf({ rows: [] });
  });
  mockDb.transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
  mockDb.query = {
    leads: { findFirst: vi.fn((opts?: { where?: unknown }) => {
      const q = opts?.where === undefined ? undefined : render(opts.where);
      if (q) reads.push(q);
      const rows = rowsForQuery(q);
      return Promise.resolve(Array.isArray(rows) ? rows[0] : undefined);
    }) },
    tenantMembers: { findFirst: vi.fn(() => Promise.resolve({ id: 'member-1' })) },
    users: { findFirst: vi.fn(() => Promise.resolve({ id: MINE, fullName: 'Me', email: 'me@x.io' })) },
    companies: { findFirst: vi.fn(() => Promise.resolve(undefined)) },
    contacts: { findFirst: vi.fn(() => Promise.resolve(undefined)) },
    pipelines: { findFirst: vi.fn(() => Promise.resolve(undefined)) },
    dealStages: { findFirst: vi.fn(() => Promise.resolve(undefined)) },
  };
});

async function call(
  mod: Record<string, unknown>,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  ctx: AuthContext,
  opts: { body?: unknown; params?: Record<string, string> } = {},
) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL(`http://localhost:3000${path}`), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  Object.defineProperty(req, 'method', { value: method });
  if (opts.body !== undefined) vi.spyOn(req, 'json').mockResolvedValue(opts.body as never);
  const handler = mod[method] as (req: NextRequest, ctx?: unknown) => Promise<Response>;
  return handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
}

const leadReads = () => reads.filter(r => r.sql.includes('"leads"'));
const contactReads = () => reads.filter(r => r.sql.includes('"contacts"."tenant_id"'));
// `dialect.sqlToQuery` renders the predicate only, so a write is identified by
// the table its WHERE clause qualifies.
const writesOn = (table: string) => writes.filter(w => w.sql.includes(`"${table}"."`));

describe('the handoff route refuses a lead the caller does not own (#2696)', () => {
  it('POST 404s on a foreign lead and never reaches the transaction', async () => {
    const res = await call(handoffRoute, 'POST', `/api/tenant/leads/${LEAD}/assign`, ctxWith(REP), {
      body: { assigned_to: OTHER, reason: 'yours now' },
      params: { id: LEAD },
    });
    const text = await res.text();
    expect(res.status, text).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: 'Lead not found' });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('POST still hands off a lead assigned to the caller', async () => {
    leadRow = { ...leadRow, assignedTo: MINE };
    const res = await call(handoffRoute, 'POST', `/api/tenant/leads/${LEAD}/assign`, ctxWith(REP), {
      body: { assigned_to: OTHER }, params: { id: LEAD },
    });
    expect(res.status, await res.text()).toBe(200);
    expect(writesOn('leads').length).toBeGreaterThan(0);
  });

  it('POST still hands off a lead the caller created', async () => {
    leadRow = { ...leadRow, createdBy: MINE };
    const res = await call(handoffRoute, 'POST', `/api/tenant/leads/${LEAD}/assign`, ctxWith(REP), {
      body: { assigned_to: OTHER }, params: { id: LEAD },
    });
    expect(res.status, await res.text()).toBe(200);
  });

  it('a view_all holder hands off any lead in the tenant', async () => {
    const res = await call(handoffRoute, 'POST', `/api/tenant/leads/${LEAD}/assign`, ctxWith(MANAGER), {
      body: { assigned_to: OTHER }, params: { id: LEAD },
    });
    expect(res.status, await res.text()).toBe(200);
    for (const read of leadReads()) expect(read.sql).not.toMatch(ownerClause('leads'));
  });
});

describe('conversion refuses a lead the caller does not own (#2696)', () => {
  async function convert(ctx: AuthContext) {
    return call(convertRoute, 'POST', `/api/tenant/leads/${LEAD}/convert`, ctx, {
      body: { create_deal: false }, params: { id: LEAD },
    });
  }

  it('the caller scope reaches convertLeadCore\'s lead lookup', async () => {
    const res = await convert(ctxWith(REP));
    const text = await res.text();
    expect(res.status, text).toBe(404);
    expect(JSON.parse(text)).toEqual({ error: 'Lead not found' });
    const lookup = leadReads()[0];
    expect(lookup, `no lead lookup rendered: ${JSON.stringify(reads.map(r => r.sql))}`).toBeTruthy();
    expect(lookup.sql).toMatch(ownerClause('leads'));
    expect(lookup.params.filter(p => p === MINE)).toHaveLength(2);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('a lead the caller owns converts', async () => {
    leadRow = { ...leadRow, assignedTo: MINE };
    const res = await convert(ctxWith(REP));
    expect(res.status, await res.text()).toBe(201);
  });

  it('the core\'s own lead writes now name the tenant, not only the id', async () => {
    // No contact_id on the lead, so both writes run: the backfill and the
    // converted flag. Neither used to state a tenant.
    leadRow = { ...leadRow, assignedTo: MINE, contactId: null };
    const res = await convert(ctxWith(REP));
    expect(res.status, await res.text()).toBe(201);
    const leadWrites = writesOn('leads');
    expect(leadWrites).toHaveLength(2);
    for (const w of leadWrites) {
      expect(w.sql).toMatch(/"leads"\."tenant_id"/i);
      expect(w.params).toContain(TENANT);
    }
  });

  it('a view_all holder converts without narrowing', async () => {
    const res = await convert(ctxWith(MANAGER));
    expect(res.status, await res.text()).toBe(201);
    for (const read of leadReads()) expect(read.sql).not.toMatch(ownerClause('leads'));
  });
});

describe('bulk assign/unassign only touch contacts the caller may touch (#2696)', () => {
  it('POST resolves its id set through the contacts rule and 404s when none are theirs', async () => {
    const res = await call(bulkAssignRoute, 'POST', '/api/tenant/leads/assign', ctxWith(REP), {
      body: { contact_ids: [CONTACT], assign_to: MINE, reason: 'mine' },
    });
    expect(res.status, await res.text()).toBe(404);
    const resolve = contactReads()[0];
    expect(resolve, `no contacts id resolution rendered: ${JSON.stringify(reads.map(r => r.sql))}`).toBeTruthy();
    expect(resolve.sql).toMatch(ownerClause('contacts'));
    expect(resolve.params.filter(p => p === MINE)).toHaveLength(2);
    expect(writesOn('contacts')).toHaveLength(0);
    expect(raws).toHaveLength(0);
  });

  it('DELETE narrows the same way before the raw trail update', async () => {
    const res = await call(bulkAssignRoute, 'DELETE', '/api/tenant/leads/assign', ctxWith(REP), {
      // `assignContactSchema` is shared with POST and requires `assign_to`,
      // which DELETE never reads.
      body: { contact_ids: [CONTACT], assign_to: MINE, reason: 'released' },
    });
    expect(res.status, await res.text()).toBe(404);
    expect(contactReads()[0].sql).toMatch(ownerClause('contacts'));
    expect(writesOn('contacts')).toHaveLength(0);
    expect(raws).toHaveLength(0);
  });

  it('POST writes only the ids that resolved, and logs history for those only', async () => {
    contactRow = { ...contactRow, assignedTo: MINE };
    const res = await call(bulkAssignRoute, 'POST', '/api/tenant/leads/assign', ctxWith(REP), {
      body: { contact_ids: [CONTACT], assign_to: MINE },
    });
    expect(res.status, await res.text()).toBe(200);
    expect(writesOn('contacts')).toHaveLength(1);
    // The trail insert names the resolved id, not the caller's raw list.
    expect(raws).toHaveLength(1);
    expect(raws[0].params).toContain(CONTACT);
  });

  it('DELETE ends the trail for rows the caller owns', async () => {
    contactRow = { ...contactRow, createdBy: MINE };
    const res = await call(bulkAssignRoute, 'DELETE', '/api/tenant/leads/assign', ctxWith(REP), {
      body: { contact_ids: [CONTACT], assign_to: MINE },
    });
    expect(res.status, await res.text()).toBe(200);
    expect(raws).toHaveLength(1);
    expect(writesOn('contacts')).toHaveLength(1);
  });

  it('a view_all holder resolves ids with no owner predicate at all', async () => {
    const res = await call(bulkAssignRoute, 'POST', '/api/tenant/leads/assign', ctxWith(MANAGER), {
      body: { contact_ids: [CONTACT], assign_to: OTHER },
    });
    expect(res.status, await res.text()).toBe(200);
    for (const read of contactReads()) expect(read.sql).not.toMatch(ownerClause('contacts'));
  });
});

describe('the assignment trail and the contact\'s Leads tab narrow (#2696)', () => {
  it('a rep gets no trail for leads that are not theirs', async () => {
    const res = await call(historyRoute, 'GET', `/api/tenant/leads/history?lead_id=${LEAD}`, ctxWith(REP));
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text).data).toEqual([]);
    const read = leadReads()[0];
    expect(read.sql).toMatch(ownerClause('leads'));
    expect(read.params.filter(p => p === MINE)).toHaveLength(2);
  });

  it('the trail keeps its tenant bound and narrows with no lead_id filter too', async () => {
    const res = await call(historyRoute, 'GET', '/api/tenant/leads/history', ctxWith(REP));
    expect(res.status, await res.text()).toBe(200);
    const read = leadReads()[0];
    expect(read.sql).toMatch(/"lead_assignments"\."tenant_id"/i);
    expect(read.params).toContain(TENANT);
    expect(read.sql).toMatch(ownerClause('leads'));
  });

  it('a rep sees only their own leads on the contact\'s Leads tab', async () => {
    const res = await call(contactLeadsRoute, 'GET', `/api/tenant/contacts/${CONTACT}/leads`, ctxWith(REP), {
      params: { id: CONTACT },
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text).data).toEqual([]);
    expect(leadReads()[0].sql).toMatch(ownerClause('leads'));
  });

  it('a view_all holder reads both unfiltered', async () => {
    const trail = await call(historyRoute, 'GET', `/api/tenant/leads/history?lead_id=${LEAD}`, ctxWith(MANAGER));
    expect((await trail.json()).data).toHaveLength(1);
    const tab = await call(contactLeadsRoute, 'GET', `/api/tenant/contacts/${CONTACT}/leads`, ctxWith(MANAGER), {
      params: { id: CONTACT },
    });
    expect((await tab.json()).data).toHaveLength(1);
    for (const read of leadReads()) expect(read.sql).not.toMatch(ownerClause('leads'));
  });

  it('the tenant and tombstone predicates survive on every read', async () => {
    await call(contactLeadsRoute, 'GET', `/api/tenant/contacts/${CONTACT}/leads`, ctxWith(REP), {
      params: { id: CONTACT },
    });
    const read = leadReads()[0];
    expect(read.sql).toMatch(/"leads"\."deleted_at" is null/i);
    expect(read.params).toContain(TENANT);
  });
});
