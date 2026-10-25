/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2692 — leads were the one entity with no owner rule on the record path.
 *
 * Contacts, deals and tasks all answer 404 when the caller lacks `<entity>.view_all`
 * and the row is neither `assigned_to` nor `created_by` them
 * (`contacts/[id]/route.ts:82-87,195-200,304-316`, `deals/[id]/route.ts:66-71,159-164`,
 * `tasks/[id]/route.ts:55-60,101-106`). `leads/[id]` fetched on
 * `id + tenant_id + deleted_at is null` and nothing else, and `leads/bulk`
 * validated its `lead_ids` against tenant and tombstone only — so a `sales_rep`
 * (whose `leads.view_all` is off, `lib/permissions/definitions.ts:134`) could read,
 * edit and trash another rep's lead by id, and drive nine bulk actions over up to
 * 500 of them in one request. The ids are readable: the contact's leads sub-list
 * and the bulk route's own audit payload both print them.
 *
 * The read side already had the rule (`leads/route.ts:90-92`), as do the export
 * (#2677), search (#2686) and dashboard (#2688) — all through `lib/api/owner-scope.ts`.
 * `can()` is left real, because the rule under test *is* the permission check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEAD = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

let selects: { sql: string; params: unknown[] }[] = [];
let writes: { kind: string; sql: string }[] = [];
let lastWhere: { sql: string; params: unknown[] } | undefined;
// What the mocked reader answers for the lead being looked at.
let leadRow: Record<string, unknown> | null = { assignedTo: OTHER, createdBy: OTHER, id: LEAD };
const mockDb = {
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
  query: {
    leads: { findFirst: vi.fn() },
    users: { findFirst: vi.fn() },
    leadActivities: { findMany: vi.fn() },
  },
};

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params };
}

/** The owner narrowing drizzle renders for `ownerScope(ctx, 'leads.view_all', leads)`. */
const OWNER_CLAUSE = /\("leads"\."assigned_to" = .* OR "leads"\."created_by" = .*\)/i;

/**
 * The mock answers a read the way Postgres would: a row the caller does not own
 * is only returned when the query itself asks for it. Without the narrowing in
 * the SQL, a foreign id resolves — which is exactly the behaviour the fix
 * removes, so the bulk assertions can fail before it and pass after.
 */
function rowsFor(query: { sql: string; params: unknown[] } | undefined) {
  if (!leadRow) return [];
  if (!query || !query.sql.includes('"leads"."tenant_id"')) return [leadRow];
  const narrowedToCaller = OWNER_CLAUSE.test(query.sql) && query.params.filter(p => p === MINE).length >= 2;
  if (!narrowedToCaller) return [leadRow];
  return leadRow.assignedTo === MINE || leadRow.createdBy === MINE ? [leadRow] : [];
}

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'returning']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    lastWhere = render(predicate);
    selects.push(lastWhere);
    return builder;
  };
  builder['limit'] = () => Promise.resolve(rowsFor(lastWhere));
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rowsFor(lastWhere));
  return builder;
}

/** `db.update(table).set(...).where(...)` / `.delete(...).where(...)` */
function makeWriter(kind: string) {
  const writer: Record<string, unknown> = {};
  writer['set'] = () => writer;
  writer['where'] = (predicate: unknown) => {
    const q = dialect.sqlToQuery(predicate as never);
    writes.push({ kind, sql: q.sql });
    return { returning: () => Promise.resolve(leadRow ? [{ id: LEAD }] : []) };
  };
  return writer;
}

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
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: async (_ctx: unknown, _entity: string, rows: unknown[]) => rows,
  enforceFieldWrite: async (_ctx: unknown, _entity: string, body: unknown) => ({ body, stripped: [] }),
  attachStrippedFields: (res: Response) => res,
}));
vi.mock('@/lib/leads/convert', () => ({ convertLeadCore: vi.fn() }));
vi.mock('@/lib/concurrency', async () => {
  const actual = await vi.importActual<typeof import('@/lib/concurrency')>('@/lib/concurrency');
  return { ...actual, withConcurrencyGuard: (fn: () => Promise<unknown>) => fn() };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const detailRoute = await import('@/app/api/tenant/leads/[id]/route');
const bulkRoute = await import('@/app/api/tenant/leads/bulk/route');

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

// sales_rep: leads.view/create/edit on, leads.view_all off (definitions.ts:134).
const REP = { 'leads.view': true, 'leads.edit': true, 'leads.delete': true, 'leads.convert': true };
const MANAGER = { ...REP, 'leads.view_all': true };

beforeEach(() => {
  selects = [];
  writes = [];
  lastWhere = undefined;
  leadRow = { assignedTo: OTHER, createdBy: OTHER, id: LEAD };
  mockDb.select.mockImplementation(() => makeBuilder());
  mockDb.query.leads = { findFirst: vi.fn(() => Promise.resolve(leadRow)) };
  mockDb.query.users = { findFirst: vi.fn(() => Promise.resolve(null)) };
  mockDb.query.leadActivities = { findMany: vi.fn(() => Promise.resolve([])) };
  mockDb.update = vi.fn(() => makeWriter('update'));
  mockDb.delete = vi.fn(() => makeWriter('delete'));
  mockDb.insert = vi.fn(() => makeWriter('insert'));
  mockDb.transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
});

function url(path: string) {
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

async function callDetail(method: 'GET' | 'PATCH' | 'DELETE', ctx: AuthContext, body?: unknown) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = url(`/api/tenant/leads/${LEAD}`);
  Object.defineProperty(req, 'method', { value: method });
  if (body !== undefined) vi.spyOn(req, 'json').mockResolvedValue(body as never);
  const handler = detailRoute[method] as (req: NextRequest, opts: unknown) => Promise<Response>;
  return handler(req, { params: Promise.resolve({ id: LEAD }) });
}

async function callBulk(ctx: AuthContext, payload: Record<string, unknown>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx);
  const req = url('/api/tenant/leads/bulk');
  Object.defineProperty(req, 'method', { value: 'POST' });
  vi.spyOn(req, 'json').mockResolvedValue(payload as never);
  return (bulkRoute.POST as (req: NextRequest) => Promise<Response>)(req);
}

const leadReads = () => selects.filter(s => s.sql.includes('"leads"."tenant_id"'));

describe('a rep cannot touch another rep\'s lead (#2692)', () => {
  it.each(['GET', 'PATCH', 'DELETE'] as const)('%s 404s on a lead they neither own nor created', async method => {
    const res = await callDetail(method, ctxWith(REP), method === 'PATCH' ? { title: 'hijacked' } : undefined);
    expect(res.status).toBe(404);
    expect(await res.json(), method).toEqual({ error: 'Lead not found' });
  });

  it('PATCH does not reach the write', async () => {
    await callDetail('PATCH', ctxWith(REP), { title: 'hijacked' });
    expect(writes).toHaveLength(0);
  });

  it('DELETE does not reach the write', async () => {
    await callDetail('DELETE', ctxWith(REP));
    expect(writes).toHaveLength(0);
  });

  it('GET does not return the row, its assignee or its activities', async () => {
    const res = await callDetail('GET', ctxWith(REP));
    expect(res.status).toBe(404);
    // The assigned-user and activity lookups are the disclosure the 404 prevents.
    expect(mockDb.query.users.findFirst).not.toHaveBeenCalled();
    expect(mockDb.query.leadActivities.findMany).not.toHaveBeenCalled();
  });

  it('a lead the caller created, or has assigned to them, still reads', async () => {
    leadRow = { assignedTo: OTHER, createdBy: MINE, id: LEAD };
    expect((await callDetail('GET', ctxWith(REP))).status).toBe(200);
    leadRow = { assignedTo: MINE, createdBy: OTHER, id: LEAD };
    expect((await callDetail('GET', ctxWith(REP))).status).toBe(200);
  });

  it('PATCH and DELETE still write for the owner', async () => {
    leadRow = { assignedTo: MINE, createdBy: MINE, id: LEAD };
    expect((await callDetail('PATCH', ctxWith(REP), { title: 'renamed' })).status).toBe(200);
    expect(writes.length).toBeGreaterThan(0);
    expect((await callDetail('DELETE', ctxWith(REP))).status).toBe(200);
  });
});

describe('the bulk id sets narrow (#2692)', () => {
  it('the live id set carries the owner predicate', async () => {
    const res = await callBulk(ctxWith(REP), { action: 'status', lead_ids: [LEAD], payload: { lead_status: 'qualified' } });
    expect(res.status, await res.text()).toBe(404);
    expect(leadReads()[0].sql).toMatch(OWNER_CLAUSE);
    expect(leadReads()[0].params.filter(p => p === MINE)).toHaveLength(2);
  });

  it('the restore id set carries it too — both sets must narrow', async () => {
    const res = await callBulk(ctxWith(REP), { action: 'restore', lead_ids: [LEAD] });
    expect(res.status, await res.text()).toBe(404);
    const trashed = selects.find(s => /"leads"\."deleted_at" is not null/i.test(s.sql));
    expect(trashed, `no restore query rendered: ${JSON.stringify(selects.map(s => s.sql))}`).toBeTruthy();
    expect(trashed!.sql).toMatch(OWNER_CLAUSE);
    expect(trashed!.params.filter(p => p === MINE)).toHaveLength(2);
  });

  it('an id set the caller owns still resolves', async () => {
    leadRow = { id: LEAD, assignedTo: MINE };
    const res = await callBulk(ctxWith(REP), { action: 'not-a-real-action', lead_ids: [LEAD] });
    // Past the "No valid leads found" bail, into the switch's own rejection.
    expect(res.status).toBe(400);
  });
});

describe('a view_all holder is unaffected', () => {
  it.each(['GET', 'PATCH', 'DELETE'] as const)('%s reads a foreign lead without narrowing', async method => {
    const res = await callDetail(method, ctxWith(MANAGER), method === 'PATCH' ? { title: 'renamed' } : undefined);
    expect(res.status, await res.text()).toBe(200);
    for (const read of leadReads()) expect(read.sql).not.toMatch(OWNER_CLAUSE);
  });

  it.each([
    ['status', { action: 'status', payload: { lead_status: 'qualified' } }],
    ['restore', { action: 'restore' }],
  ])('%s bulk resolves ids unfiltered', async (_action, extra) => {
    leadRow = { id: LEAD };
    const res = await callBulk(ctxWith(MANAGER), { lead_ids: [LEAD], ...extra });
    expect(leadReads().length).toBeGreaterThanOrEqual(1);
    for (const read of leadReads()) expect(read.sql).not.toMatch(OWNER_CLAUSE);
    expect(res.status, await res.text()).not.toBe(404);
  });

  it('the tenant and tombstone predicates survive', async () => {
    await callBulk(ctxWith(REP), { action: 'status', lead_ids: [LEAD], payload: { lead_status: 'qualified' } });
    expect(leadReads()[0].params).toContain(TENANT);
    expect(leadReads()[0].sql).toMatch(/deleted_at/i);
  });
});
