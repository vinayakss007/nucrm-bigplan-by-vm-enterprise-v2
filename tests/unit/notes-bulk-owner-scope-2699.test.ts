/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2699 — `notes/bulk` wrote to rows the record path refuses.
 *
 * The route resolves `entity_ids` against tenant and tombstone only, then inserts a
 * note per id. Every entity it serves — contact, deal, lead, task — answers 404 on
 * `GET/PATCH/DELETE /<entity>/<id>` unless the row is `assigned_to` or `created_by`
 * the caller, or the caller holds `<entity>.view_all` (#2671, #2673, #2674, #2692).
 * A `sales_rep` (all four `view_all` off, `lib/permissions/definitions.ts:132-144`)
 * could therefore attach a note to up to 500 rows per request that it cannot open,
 * and the note then appears in that row's own timeline for its real owner to see.
 * UI-reachable: `components/tenant/contacts-data-table.tsx:592` posts exactly this
 * shape for the selected rows.
 *
 * `company` is left tenant-scoped on purpose. `companies.view_all` is defined
 * (`definitions.ts:43`) and enforced nowhere — neither `companies/route.ts` nor
 * `companies/[id]/route.ts` references it — so narrowing only this writer would
 * invent an owner rule the entity does not have. That test asserts the gap stays
 * visible rather than quietly closed or quietly opened.
 *
 * There is no `notes.*` permission in the catalogue, so the gate cannot be
 * "can you write notes" — it has to be the owner rule on the row being written to.
 *
 * `can()` is left real, because the rule under test *is* the permission check.
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

// The table the route is being asked to write against, in each test's `entity_type`.
const TABLES = ['contacts', 'deals', 'leads', 'companies', 'tasks'];

/** What `ownerScope(ctx, '<entity>.view_all', …)` renders for a non-holder. */
const OWNER = (table: string) =>
  new RegExp(`\\("${table}"\\."assigned_to" = .* OR "${table}"\\."created_by" = .*\\)`, 'i');

/** True when drizzle rendered the narrowing and bound the caller to both sides of it. */
function narrowedToCaller(query: { sql: string; params: unknown[] }, table: string) {
  return OWNER(table).test(query.sql) && query.params.filter(p => p === MINE).length >= 2;
}

let selects: { sql: string; params: unknown[] }[] = [];
let inserts: unknown[][] = [];
let lastWhere: { sql: string; params: unknown[] } | undefined;
// The ids the request names, and which of them the caller actually owns.
let requested: string[] = [FOREIGN];
let owned: Set<string> = new Set();

/**
 * Answer the id-resolution read the way Postgres would for this tenant: an
 * `id = ANY(…)` scoped only by tenant matches every id the caller names, owned or
 * not. Once the owner predicate is in the SQL, the foreign ones stop matching.
 * Without that difference the test would pass before the fix as well as after it.
 */
function rowsFor(query: { sql: string; params: unknown[] } | undefined) {
  if (!query) return [];
  const table = TABLES.find(t => query.sql.includes(`"${t}"."tenant_id"`));
  if (!table) return [];
  if (table === 'companies') return requested.map(id => ({ id }));
  return (narrowedToCaller(query, table)
    ? requested.filter(id => owned.has(id))
    : requested
  ).map(id => ({ id }));
}

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    lastWhere = dialect.sqlToQuery(predicate as never);
    selects.push(lastWhere);
    return builder;
  };
  builder['limit'] = () => Promise.resolve(rowsFor(lastWhere));
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rowsFor(lastWhere));
  return builder;
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/audit', async (importOriginal) => ({
  // #3220: only the writer is faked — `bulkIdsAudit` is the shape under test,
  // so a mock that omits it turns every bulk route into a 500.
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const bulkRoute = await import('@/app/api/tenant/notes/bulk/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: the four entity view_all flags are off (definitions.ts:132-144), and
// this route checks nothing else, so an empty grant set is the rep's position here.
const REP: Record<string, boolean> = {};

// manager: every non-danger permission, so all five view_all flags are on.
const MANAGER = {
  'contacts.view_all': true, 'deals.view_all': true, 'leads.view_all': true,
  'companies.view_all': true, 'tasks.view_all': true,
};

beforeEach(() => {
  selects = [];
  inserts = [];
  lastWhere = undefined;
  requested = [FOREIGN];
  owned = new Set();
  mockDb.select.mockImplementation(() => makeBuilder());
  mockDb.insert.mockImplementation(() => ({
    values: (rows: unknown[]) => {
      inserts.push(rows);
      return Promise.resolve([{ id: 'note-1' }]);
    },
  }));
});

async function callBulk(ctx: AuthContext, payload: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = new NextRequest(new URL('http://localhost:3000/api/tenant/notes/bulk'), {
    method: 'POST',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
  vi.spyOn(req, 'json').mockResolvedValue(payload as never);
  return bulkRoute.POST(req as never);
}

const write = (entity_type: string, entity_ids = requested) =>
  callBulk(ctxWith(REP), { entity_type, entity_ids, content: 'handover note' });

const readOn = (table: string) => selects.filter(s => s.sql.includes(`"${table}"."tenant_id"`));

describe('a rep cannot note a row they do not own (#2699)', () => {
  it.each(['contact', 'deal', 'lead', 'task'] as const)('%s: 404 and no note written', async entity_type => {
    const res = await write(entity_type);
    expect(res.status, `${entity_type}: ${await res.text()}`).toBe(404);
    expect(inserts, entity_type).toHaveLength(0);
  });

  it.each(['contact', 'deal', 'lead', 'task'] as const)('%s: the id read carries the owner predicate', async entity_type => {
    await write(entity_type);
    const table = { contact: 'contacts', deal: 'deals', lead: 'leads', task: 'tasks' }[entity_type];
    const q = readOn(table)[0];
    expect(q, `no ${table} read rendered: ${JSON.stringify(selects.map(s => s.sql))}`).toBeTruthy();
    expect(q.sql).toMatch(OWNER(table));
    expect(q.params.filter(p => p === MINE)).toHaveLength(2);
  });

  it('a foreign id mixed with an owned one writes only for the owned row', async () => {
    requested = [OWNED, FOREIGN];
    owned = new Set([OWNED]);
    const res = await write('contact');
    const body = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toHaveLength(1);
    expect((inserts[0][0] as { entityId: string }).entityId).toBe(OWNED);
    expect(body).toEqual({ ok: true, affected: 1 });
  });

  it('a row the caller owns still takes the note', async () => {
    owned = new Set([FOREIGN]);
    const res = await write('contact');
    expect(res.status, await res.text()).toBe(200);
    expect(inserts[0]).toHaveLength(1);
  });
});

describe('company stays tenant-scoped until its view_all rule exists (#2699)', () => {
  it('a rep can note a company they neither own nor created — the gap is documented, not closed here', async () => {
    const res = await write('company');
    expect(res.status, await res.text()).toBe(200);
    expect(readOn('companies')[0].sql).not.toMatch(OWNER('companies'));
  });
});

describe('a view_all holder is unaffected (#2699)', () => {
  it.each(['contact', 'deal', 'lead', 'company', 'task'] as const)('%s: no narrowing, foreign id resolves', async entity_type => {
    const res = await callBulk(ctxWith(MANAGER), { entity_type, entity_ids: [FOREIGN], content: 'team note' });
    expect(res.status, await res.text()).toBe(200);
    for (const table of TABLES) {
      for (const q of readOn(table)) expect(q.sql).not.toMatch(OWNER(table));
    }
  });
});

describe('the tenant and tombstone predicates survive (#2699)', () => {
  it.each(['contact', 'deal', 'lead', 'task'] as const)('%s', async entity_type => {
    await write(entity_type);
    const table = { contact: 'contacts', deal: 'deals', lead: 'leads', task: 'tasks' }[entity_type];
    const q = readOn(table)[0];
    expect(q.params).toContain(TENANT);
    expect(q.sql).toMatch(/deleted_at is null/i);
  });
});
