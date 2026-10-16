/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2692 — leads were the one entity with no owner rule on the record path.
 *
 * Contacts, deals and tasks all refuse a row the caller does not own, with a
 * 404 rather than a 403, when the role lacks `<entity>.view_all`:
 * `contacts/[id]/route.ts:82-87,195-200,304-316`, `deals/[id]/route.ts:66-71,159-164`,
 * `tasks/[id]/route.ts:55-60,101-106`. Leads read it only for listing
 * (`leads/route.ts:90-92`), never for the record: `[id]` GET (`:85-91`), PATCH
 * (`:179-186`) and DELETE (`:298-306`) all key on `id + tenant_id + tombstone`,
 * and `bulk` validated its ids the same way (`bulk/route.ts:45-53`) plus a
 * second, equally unguarded id set for `restore` (`:295-304`) — while
 * `tasks/bulk:82-85`, `deals/bulk:81-84`, `contacts/bulk:124` and even
 * `deals/bulk:417` (its own restore case) all carry the scope.
 *
 * So one `PATCH /api/tenant/leads/<uuid>` from a sales_rep renamed another
 * rep's lead, and `POST /api/tenant/leads/bulk` did it to 500 of them at once.
 *
 * Asserted on the SQL drizzle renders, with `can()` left real: the rule under
 * test is exactly the permission check, so a mocked middleware would grade the
 * mock. The manager controls matter as much as the rep cases — a `view_all`
 * holder's SQL must stay what it was.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dialect = new PgDialect({} as never);

let wheres: { sql: string; params: unknown[] }[] = [];
let rows: unknown[] = [{ id: LEAD, updatedAt: new Date('2026-01-01'), firstName: 'Ada', leadStatus: 'new' }];
let findFirstRow: unknown = { id: LEAD, tenantId: TENANT, assignedTo: OTHER, createdBy: OTHER, firstName: 'Ada', lastName: 'L', leadStatus: 'new' };

const mockDb: Record<string, unknown> = {
  select: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  // GET also reads the assignee, the creator and the activity trail
  // (`leads/[id]/route.ts:100-125`), so the relations namespace needs all three.
  query: {
    leads: { findFirst: vi.fn() },
    users: { findFirst: async () => null },
    leadActivities: { findMany: async () => [] },
  },
};

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'limit', 'offset', 'returning']) builder[m] = chain;
  builder['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params });
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return builder;
}

function makeUpdateBuilder() {
  const builder = makeBuilder();
  builder['set'] = () => builder;
  return builder;
}

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: async () => undefined }));
vi.mock('@/lib/leads/convert', () => ({ convertLeadCore: async () => ({ ok: true }) }));
vi.mock('@/lib/rbac/enforce', () => ({
  enforceFieldRead: (_ctx: unknown, _entity: string, r: unknown[]) => Promise.resolve(r),
  enforceFieldWrite: (_ctx: unknown, _entity: string, body: unknown) => Promise.resolve({ body, stripped: [] }),
  attachStrippedFields: (_res: unknown, _stripped: unknown) => _res,
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const leadId = await import('@/app/api/tenant/leads/[id]/route');
const leadBulk = await import('@/app/api/tenant/leads/bulk/route');

function ctxWith(permissions: Record<string, boolean>, slug = 'rep'): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: slug, permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

const REP = { 'leads.view': true, 'leads.edit': true, 'leads.assign': true, 'leads.delete': true };
const MANAGER = { ...REP, 'leads.view_all': true };

function setup(permissions: Record<string, boolean>, over: Record<string, unknown> = {}) {
  wheres = [];
  rows = [{ id: LEAD, updatedAt: new Date('2026-01-01'), firstName: 'Ada', leadStatus: 'new' }];
  findFirstRow = {
    id: LEAD, tenantId: TENANT, assignedTo: OTHER, createdBy: OTHER,
    firstName: 'Ada', lastName: 'L', leadStatus: 'new',
  };
  mockDb.select.mockImplementation(() => makeBuilder());
  mockDb.update.mockImplementation(() => makeUpdateBuilder());
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn({
    update: () => makeUpdateBuilder(),
    insert: () => ({ values: async () => [] }),
  }));
  const findFirst = vi.fn(async () =>
    (over.findFirstRow === undefined ? findFirstRow : over.findFirstRow));
  (mockDb.query as { leads: { findFirst: unknown } }).leads.findFirst = findFirst;
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(permissions));
}

async function callRecord(
  mod: Record<string, unknown>, method: 'GET' | 'PATCH' | 'DELETE', body?: unknown,
) {
  const handler = mod[method] as (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  return handler(
    new NextRequest(new URL(`/api/tenant/leads/${LEAD}`, 'http://localhost:3000'), {
      method,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: LEAD }) },
  );
}

async function bulk(payload: Record<string, unknown>) {
  const handler = leadBulk.POST as (req: NextRequest) => Promise<Response>;
  return handler(
    new NextRequest(new URL('/api/tenant/leads/bulk', 'http://localhost:3000'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify(payload),
    }),
  );
}

/** `assigned_to = me OR created_by = me`, both halves bound to the caller. */
const ownsBoth = (clause: { sql: string; params: unknown[] }) =>
  /"leads"\."assigned_to".*=.*or.*"leads"\."created_by".*=/.test(clause.sql)
  && clause.params.filter(p => p === MINE).length === 2;

const scoped = (pred: (c: { sql: string; params: unknown[] }) => boolean) =>
  wheres.some(ownsBoth) === true && wheres.some(pred);

describe('a rep cannot read or write a lead they do not own (#2692)', () => {
  it('GET answers 404 for another rep\'s lead, as contacts/[id]:82 and tasks/[id]:55 do', async () => {
    setup(REP);
    const res = await callRecord(leadId, 'GET');
    expect(res.status, await res.text()).toBe(404);
  });

  it('PATCH answers 404 rather than renaming it', async () => {
    setup(REP);
    const res = await callRecord(leadId, 'PATCH', { lead_status: 'qualified' });
    expect(res.status, await res.text()).toBe(404);
  });

  it('DELETE answers 404 rather than trashing it', async () => {
    setup(REP);
    const res = await callRecord(leadId, 'DELETE');
    expect(res.status, await res.text()).toBe(404);
    // DELETE wrote straight from the key before the fix; a pre-read is required.
    expect(wheres.length, wheres.map(w => w.sql).join('\n')).toBeGreaterThan(0);
  });

  it('a lead assigned to me still reads', async () => {
    setup(REP, { findFirstRow: { id: LEAD, tenantId: TENANT, assignedTo: MINE, createdBy: OTHER, firstName: 'Ada', lastName: 'L', leadStatus: 'new' } });
    const res = await callRecord(leadId, 'GET');
    expect(res.status, await res.text()).toBe(200);
  });

  it('a lead I created but handed off still reads', async () => {
    setup(REP, { findFirstRow: { id: LEAD, tenantId: TENANT, assignedTo: OTHER, createdBy: MINE, firstName: 'Ada', lastName: 'L', leadStatus: 'new' } });
    const res = await callRecord(leadId, 'GET');
    expect(res.status, await res.text()).toBe(200);
  });
});

describe('leads/bulk narrows both of its id sets (#2692)', () => {
  it('the live-id validation carries the owner predicate, as tasks/bulk:82 and deals/bulk:81 do', async () => {
    setup(REP);
    const res = await bulk({ action: 'status', lead_ids: [LEAD], payload: { lead_status: 'contacted' } });
    expect(res.status, await res.text()).toBe(200);
    expect(wheres[0].sql, wheres[0].sql).toMatch(/"leads"\."tenant_id"/);
    expect(ownsBoth(wheres[0]), wheres[0].sql).toBe(true);
  });

  it('delete goes through the same narrowed set', async () => {
    setup(REP);
    const res = await bulk({ action: 'delete', lead_ids: [LEAD] });
    expect(res.status, await res.text()).toBe(200);
    expect(wheres.some(ownsBoth), wheres.map(w => w.sql).join('\n')).toBe(true);
  });

  it('restore re-resolves ids with the scope too — both sets must narrow', async () => {
    setup(REP);
    const res = await bulk({ action: 'restore', lead_ids: [LEAD] });
    expect(res.status, await res.text()).toBe(200);
    // The restore set is resolved against `deleted_at IS NOT NULL`, which is a
    // different query from the live validation; it was the unguarded one.
    const trashed = wheres.filter(w => /"leads"\."deleted_at" is not null/i.test(w.sql));
    expect(trashed.length, wheres.map(w => w.sql).join('\n')).toBeGreaterThan(0);
    expect(trashed.some(ownsBoth), trashed.map(w => w.sql).join('\n')).toBe(true);
  });

  it('a status filter does not displace the scope', async () => {
    setup(REP);
    await bulk({ action: 'assign', lead_ids: [LEAD], payload: { assigned_to: OTHER } });
    expect(scoped(c => /"leads"\."tenant_id"/.test(c.sql)), wheres.map(w => w.sql).join('\n')).toBe(true);
  });
});

describe('a leads.view_all holder keeps the tenant-wide record path (#2692)', () => {
  it('GET, PATCH and DELETE all succeed for another rep\'s lead', async () => {
    setup(MANAGER);
    expect((await callRecord(leadId, 'GET')).status).toBe(200);
    setup(MANAGER);
    const patch = await callRecord(leadId, 'PATCH', { lead_status: 'qualified' });
    expect(patch.status, await patch.text()).toBe(200);
    setup(MANAGER);
    const del = await callRecord(leadId, 'DELETE');
    expect(del.status, await del.text()).toBe(200);
  });

  it('bulk renders no owner predicate for a manager', async () => {
    setup(MANAGER);
    const res = await bulk({ action: 'status', lead_ids: [LEAD], payload: { lead_status: 'contacted' } });
    expect(res.status, await res.text()).toBe(200);
    expect(wheres[0].sql).not.toMatch(/"leads"\."created_by"/);
    expect(wheres[0].params.filter(p => p === MINE)).toHaveLength(0);
  });
});
