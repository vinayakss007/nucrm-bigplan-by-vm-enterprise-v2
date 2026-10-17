/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2745 — duplicate discovery leaks the identities of contacts the caller cannot read.
 *
 * `GET /api/tenant/contacts/duplicates` builds its groups from three raw
 * aggregates over `contacts` (app/api/tenant/contacts/duplicates/route.ts:29-68)
 * whose only row term is `tenant_id`, and its detail read (`:105-115`) filters on
 * `inArray(contacts.id, allIds)` alone — no tenant, no owner. `contacts` has an
 * enforced record rule: without `contacts.view_all` a caller reaches only rows
 * where `assigned_to = me OR created_by = me`, and `contacts/[id]:82-87` answers
 * 404 otherwise; the shipped `sales_rep` block holds `view_all: false`
 * (lib/permissions/definitions.ts:132-137).
 *
 * So `match_value` — the shared e-mail address, phone number or full name — is
 * the PII of rows the caller is not allowed to open, and `contact_ids` names them.
 * `enforceFieldRead` (`:120`, #2618) narrows *columns*, and only for the first 20
 * groups' detail rows; it cannot see a group whose own aggregate leaked the value.
 *
 * The reader below is not canned: it answers a contact only as Postgres would, by
 * looking at whether the statement the route actually rendered narrows to the
 * caller. A route that never emits the owner predicate therefore reports the
 * cross-owner group, and the fixed one does not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const dialect = new PgDialect({} as never);

const OWNER_CLAUSE = /\("contacts"\."assigned_to" = .* OR "contacts"\."created_by" = .*\)/i;

const SHARED_EMAIL = 'lead@corp.example';
const SHARED_PHONE = '+15550000111';

interface Row {
  id: string; tenantId: string; email: string | null; phone: string | null;
  firstName: string | null; lastName: string | null;
  assignedTo: string | null; createdBy: string | null; deletedAt: Date | null;
}

function row(id: string, over: Partial<Row>): Row {
  return {
    id, tenantId: TENANT, email: null, phone: null,
    firstName: null, lastName: null, assignedTo: MINE, createdBy: MINE, deletedAt: null,
    ...over,
  };
}

/**
 * rep1 owns c1 and c3; rep2 owns c2. c1/c2 share an e-mail, c1/c3 a phone and all
 * three a name. A fourth contact is a different tenant's and must never surface.
 */
function seed(): Row[] {
  return [
    row('c1', { email: SHARED_EMAIL, phone: SHARED_PHONE, firstName: 'Lex', lastName: 'Row' }),
    row('c2', { email: SHARED_EMAIL, phone: '+15550000222', firstName: 'Lex', lastName: 'Row', assignedTo: OTHER, createdBy: OTHER }),
    row('c3', { email: 'solo@corp.example', phone: SHARED_PHONE, firstName: 'Lex', lastName: 'Row', assignedTo: MINE, createdBy: OTHER }),
    row('c4', { email: SHARED_EMAIL, phone: SHARED_PHONE, firstName: 'Lex', lastName: 'Row', tenantId: OTHER_TENANT }),
    row('c5', { email: 'gone@corp.example', firstName: 'Gone', lastName: 'Row', deletedAt: new Date() }),
  ];
}

let rows: Row[] = [];
let executed: { sql: string; params: unknown[] }[] = [];
let lastWhere: { sql: string; params: unknown[] } | undefined;

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/** Which contacts may this statement see? Decided from the statement itself. */
function visibleFor(query: { sql: string; params: unknown[] }): Row[] {
  const tenantPinned = /tenant_id/.test(query.sql) && query.params.includes(TENANT);
  const narrowed = OWNER_CLAUSE.test(query.sql)
    && query.params.filter((p) => p === MINE).length >= 2;
  return rows.filter(r =>
    (!tenantPinned || r.tenantId === TENANT)
    && r.deletedAt === null
    && (!narrowed || r.assignedTo === MINE || r.createdBy === MINE),
  );
}

function group(ids: string[]) {
  return { contact_ids: ids, cnt: String(ids.length) };
}

/** The three aggregates, answered the way the GROUP BY … HAVING count(*) > 1 would. */
function runAggregate(query: { sql: string; params: unknown[] }) {
  const seen = visibleFor(query);
  if (query.sql.includes('LOWER(email)')) {
    const byEmail = new Map<string, string[]>();
    for (const r of seen) if (r.email) byEmail.set(r.email.toLowerCase(), [...(byEmail.get(r.email.toLowerCase()) ?? []), r.id]);
    return [...byEmail.entries()].filter(([, ids]) => ids.length > 1)
      .slice(0, 50).map(([email, ids]) => ({ email, ...group(ids) }));
  }
  if (query.sql.includes('GROUP BY phone')) {
    const byPhone = new Map<string, string[]>();
    for (const r of seen) if (r.phone) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r.id]);
    return [...byPhone.entries()].filter(([, ids]) => ids.length > 1)
      .slice(0, 30).map(([phone, ids]) => ({ phone, ...group(ids) }));
  }
  const byName = new Map<string, string[]>();
  for (const r of seen) {
    if (!r.firstName) continue;
    const key = `${r.firstName} ${r.lastName ?? ''}`.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), r.id]);
  }
  return [...byName.entries()].filter(([, ids]) => ids.length > 1)
    .slice(0, 30).map(([full_name, ids]) => ({ full_name, ...group(ids) }));
}

function detailRead(query: { sql: string; params: unknown[] }) {
  const ids = query.params.filter((p): p is string => typeof p === 'string' && /^c\d$/.test(p));
  return visibleFor(query).filter(r => ids.includes(r.id)).map(r => ({
    id: r.id, firstName: r.firstName, lastName: r.lastName, email: r.email,
    phone: r.phone, createdAt: new Date(),
  }));
}

const mockDb: Record<string, unknown> = {
  execute: vi.fn(),
  select: vi.fn(),
};

function makeSelectBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    lastWhere = render(predicate);
    return builder;
  };
  builder['then'] = (done: (v: unknown) => unknown) => Promise.resolve(detailRead(lastWhere ?? { sql: '', params: [] })).then(done);
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
// #2618's own suite grades the column projection; here it is a pass-through so a
// dropped row is unambiguously the aggregate's doing.
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: async (_ctx: unknown, _table: string, r: unknown[]) => r,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const duplicatesRoute = await import('@/app/api/tenant/contacts/duplicates/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: contacts.view_all off (lib/permissions/definitions.ts:132-137).
const REP = { 'contacts.view': true, 'contacts.edit': true };
const MANAGER = { ...REP, 'contacts.view_all': true };

async function call(ctx: AuthContext) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/contacts/duplicates'));
  return (duplicatesRoute.GET as (req: NextRequest) => Promise<Response>)(req);
}

async function jsonOf(res: Response) {
  return res.json() as Promise<{ data: { groups: Array<{ match_type: string; match_value: string; contact_ids: string[]; contacts: { id: string }[] }>; total_duplicate_groups: number; total_duplicate_contacts: number } }>;
}

beforeEach(() => {
  rows = seed();
  executed = [];
  lastWhere = undefined;
  mockDb.execute.mockImplementation(async (fragment: unknown) => {
    const q = render(fragment);
    executed.push(q);
    return { rows: runAggregate(q) };
  });
  mockDb.select.mockImplementation(() => makeSelectBuilder());
});

describe('a rep only discovers duplicates among their own contacts (#2745)', () => {
  it('the three aggregates narrow to the caller', async () => {
    await call(ctxWith(REP));
    expect(executed).toHaveLength(3);
    for (const q of executed) {
      expect(q.sql, q.sql).toMatch(OWNER_CLAUSE);
      expect(q.params.filter((p) => p === MINE)).toHaveLength(2);
      // The owner rule is added to the tenant rule, never instead of it.
      expect(/tenant_id/.test(q.sql), q.sql).toBe(true);
      expect(q.params).toContain(TENANT);
    }
  });

  it('a group whose other half belongs to another rep is not reported at all', async () => {
    const res = await jsonOf(await call(ctxWith(REP)));
    const emails = res.data.groups.filter(g => g.match_type === 'email');
    expect(emails.map(g => g.match_value), JSON.stringify(res.data.groups)).not.toContain(SHARED_EMAIL);
  });

  it('no foreign contact id and no foreign PII reaches the response', async () => {
    const res = await jsonOf(await call(ctxWith(REP)));
    const body = JSON.stringify(res.data);
    const ids = res.data.groups.flatMap(g => [...g.contact_ids, ...g.contacts.map(c => c.id)]);
    expect(ids, body).not.toContain('c2');
    // c2's own phone number: the value a group would leak even without the id.
    expect(body, body).not.toContain('+15550000222');
    expect(body, body).not.toContain(OTHER_TENANT);
  });

  it('the counts count what the caller may see', async () => {
    const res = await jsonOf(await call(ctxWith(REP)));
    // Only c1 and c3 are reachable, so the shared e-mail group (c1+c2) vanishes
    // and the phone/name groups collapse to the two rows the caller owns.
    expect(res.data.total_duplicate_contacts, JSON.stringify(res.data)).toBe(2);
    expect(res.data.groups.flatMap(g => g.contact_ids), JSON.stringify(res.data)).toEqual(['c1', 'c3']);
  });

  it('the detail read carries the tenant term it was missing', async () => {
    await call(ctxWith(REP));
    expect(lastWhere, 'no detail read ran').toBeTruthy();
    expect(lastWhere!.sql, lastWhere!.sql).toMatch(/"contacts"\."tenant_id"/);
    expect(lastWhere!.params).toContain(TENANT);
    expect(lastWhere!.sql).toMatch(OWNER_CLAUSE);
  });
});

describe('a contacts.view_all holder still sees the whole workspace (#2745)', () => {
  it('their aggregates are byte-for-byte the tenant-only queries they were', async () => {
    await call(ctxWith(MANAGER));
    expect(executed).toHaveLength(3);
    for (const q of executed) {
      expect(q.sql, q.sql).not.toMatch(OWNER_CLAUSE);
      expect(q.params).not.toContain(MINE);
    }
  });

  it('the cross-owner group is reported, with both halves', async () => {
    const res = await jsonOf(await call(ctxWith(MANAGER)));
    const emailGroup = res.data.groups.find(g => g.match_type === 'email' && g.match_value === SHARED_EMAIL);
    expect(emailGroup, JSON.stringify(res.data.groups)).toBeTruthy();
    expect([...emailGroup!.contact_ids].sort()).toEqual(['c1', 'c2']);
    expect(emailGroup!.contacts.map(c => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('another tenant is still excluded', async () => {
    const res = await jsonOf(await call(ctxWith(MANAGER)));
    const body = JSON.stringify(res.data);
    expect(body).not.toContain('c4');
    expect(res.data.groups.every(g => g.contact_ids.every(id => id !== 'c5'))).toBe(true);
  });
});
