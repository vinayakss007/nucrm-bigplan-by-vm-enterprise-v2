/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2777 — the two analytics `calculate` POSTs prove an id is in the caller's tenant
 * and not soft-deleted, then read and return its forecast / churn profile. They never
 * ask whose it is.
 *
 * `deals/[id]/forecast/route.ts:31-43` answers the *same* `deal_forecasts` row behind
 * an `ownerScope` term added under #2709, and `deals/[id]/route.ts:67-72` and
 * `contacts/[id]/route.ts:82-87` both 404 a row the caller neither owns nor created.
 * The analytics pair is the one door left open to that row for a `sales_rep`, whose
 * `deals.view_all` and `contacts.view_all` are explicitly false
 * (`lib/permissions/definitions.ts:133`, `:135`) while `deals.edit` and `contacts.edit`
 * are true — and `edit` is the only gate these two routes check.
 *
 * `can()` is left real, because the permission it consults *is* the behaviour under
 * test: mocking it would grade the mock. The two existing tests for this pair
 * (`analytics-post-tenant-scope-2524.test.ts:36`, `churn-soft-deleted-2556.test.ts:33`)
 * pin the tenant and tombstone terms with `can` hard-wired to true, which is why
 * neither of them can see this bug.
 *
 * The mocked reader answers the way Postgres would: the deal resolves whenever the
 * rendered SQL does not narrow to the caller, so the unscoped route fails these tests
 * rather than passing them vacuously.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = '77777777-7777-4777-8777-777777777777';
const PEER = '88888888-8888-4888-8888-888888888888';
const DEAL = '99999999-9999-4999-8999-999999999999';
const CONTACT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const dialect = new PgDialect({} as never);

/** What a `sales_rep` holds: edit yes, view_all no (definitions.ts:133, :135). */
const REP: Record<string, boolean> = { 'deals.edit': true, 'contacts.edit': true };
const MANAGER: Record<string, boolean> = {
  ...REP, 'deals.view_all': true, 'contacts.view_all': true,
};

const FORECAST_ROW = {
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', dealId: DEAL, tenantId: TENANT,
  winProbability: '60', predictedValue: '4000', originalValue: '5000',
};
const PREDICTION_ROW = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', contactId: CONTACT, tenantId: TENANT,
  churnProbability: '0.7', churnRisk: 'high',
};

/** The owner narrowing `ownerScope(ctx, 'deals.view_all', deals)` renders. */
const dealOwnerClause = /\("deals"\."assigned_to" = .* OR "deals"\."created_by" = .*\)/i;
const contactOwnerClause = /\("contacts"\."assigned_to" = .* OR "contacts"\."created_by" = .*\)/i;

let owners: { assignedTo: string; createdBy: string } = { assignedTo: PEER, createdBy: PEER };
let reads: { sql: string; params: unknown[] }[] = [];
let rpcCalls = 0;

function render(predicate: unknown) {
  const q = dialect.sqlToQuery(predicate as never);
  return { sql: q.sql, params: q.params };
}

/**
 * Would Postgres hand back this entity probe? A query that never narrows to the
 * caller resolves for anybody in the tenant — the bug. A narrowed one is answered by
 * the row's real ownership.
 */
function probeResolves(q: { sql: string; params: unknown[] }, clause: RegExp): boolean {
  const narrowed = clause.test(q.sql) && q.params.filter((p) => p === MINE).length >= 2;
  if (!narrowed) return true;
  return owners.assignedTo === MINE || owners.createdBy === MINE;
}

function answer(q: { sql: string; params: unknown[] }): unknown[] {
  if (/"deals"\."id"/i.test(q.sql)) return probeResolves(q, dealOwnerClause) ? [{ id: DEAL }] : [];
  if (/"contacts"\."id"/i.test(q.sql)) return probeResolves(q, contactOwnerClause) ? [{ id: CONTACT }] : [];
  if (/"deal_forecasts"\./i.test(q.sql)) return [FORECAST_ROW];
  if (/"churn_predictions"\./i.test(q.sql)) return [PREDICTION_ROW];
  return [];
}

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit']) builder[m] = chain;
  let last: { sql: string; params: unknown[] } | undefined;
  builder['where'] = (predicate: unknown) => {
    last = render(predicate);
    reads.push(last);
    return builder;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(last ? answer(last) : []);
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn(),
  execute: vi.fn(async () => {
    rpcCalls += 1;
    return { rows: [{ probability: 0.42 }] };
  }),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/with-api-route')>('@/lib/api/with-api-route');
  return { ...actual, withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const forecastRoute = await import('@/app/api/tenant/analytics/forecast/route');
const churnRoute = await import('@/app/api/tenant/analytics/churn/route');

function ctx(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'sales_rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

function postReq(path: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  });
}

/** `permissions` for the caller, `as` for who the named entity belongs to. */
function setup(permissions: Record<string, boolean>, as: { assignedTo?: string; createdBy?: string } = {}) {
  owners = { assignedTo: as.assignedTo ?? PEER, createdBy: as.createdBy ?? PEER };
  reads = [];
  rpcCalls = 0;
  mockDb.select.mockImplementation(() => makeBuilder());
  mockDb.execute.mockClear().mockImplementation(async () => {
    rpcCalls += 1;
    return { rows: [{ probability: 0.42 }] };
  });
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctx(permissions));
}

const runForecast = (permissions: Record<string, boolean>, as = {}) => {
  setup(permissions, as);
  return forecastRoute.POST(postReq('/api/tenant/analytics/forecast', { deal_id: DEAL }));
};
const runChurn = (permissions: Record<string, boolean>, as = {}) => {
  setup(permissions, as);
  return churnRoute.POST(postReq('/api/tenant/analytics/churn', { contact_id: CONTACT }));
};

const dealProbes = () => reads.filter((r) => /"deals"\."id"/i.test(r.sql));
const contactProbes = () => reads.filter((r) => /"contacts"\."id"/i.test(r.sql));
const bodyOf = async (res: Response) => JSON.stringify(await res.json());

beforeEach(() => {
  setup(REP);
});

describe('a rep cannot score a peer deal through the analytics route (#2777)', () => {
  it('answers 404 for a deal they neither own nor created', async () => {
    const res = await runForecast(REP);
    const text = await bodyOf(res);
    expect(res.status, text).toBe(404);
    expect(text).toContain('Deal not found');
  });

  it('never runs the win-probability RPC on it', async () => {
    await runForecast(REP);
    expect(rpcCalls, 'the RPC computed on a deal the caller cannot open').toBe(0);
  });

  it('never reads the forecast row that is the actual leak', async () => {
    await runForecast(REP);
    expect(reads.filter((r) => /"deal_forecasts"\./i.test(r.sql)), JSON.stringify(reads)).toHaveLength(0);
  });

  it('the probe narrows to the caller in SQL, not only in the status code', async () => {
    await runForecast(REP);
    const [probe] = dealProbes();
    expect(probe, JSON.stringify(reads)).toBeTruthy();
    expect(probe.sql).toMatch(dealOwnerClause);
    expect(probe.params.filter((p) => p === MINE)).toHaveLength(2);
  });

  it('keeps the tenant and tombstone terms #2524 and #2556 added', async () => {
    await runForecast(REP);
    const [probe] = dealProbes();
    expect(probe.sql).toMatch(/"deals"\."tenant_id"/i);
    expect(probe.sql).toMatch(/"deals"\."deleted_at" IS NULL/i);
    expect(probe.params).toContain(TENANT);
  });
});

describe('a rep cannot score a peer contact through the analytics route (#2777)', () => {
  it('answers 404 for a contact they neither own nor created', async () => {
    const res = await runChurn(REP);
    const text = await bodyOf(res);
    expect(res.status, text).toBe(404);
    expect(text).toContain('Contact not found');
  });

  it('never runs the churn RPC or reads the prediction', async () => {
    await runChurn(REP);
    expect(rpcCalls).toBe(0);
    expect(reads.filter((r) => /"churn_predictions"\./i.test(r.sql)), JSON.stringify(reads)).toHaveLength(0);
  });

  it('the probe carries the contact owner predicate', async () => {
    await runChurn(REP);
    const [probe] = contactProbes();
    expect(probe, JSON.stringify(reads)).toBeTruthy();
    expect(probe.sql).toMatch(contactOwnerClause);
    expect(probe.params.filter((p) => p === MINE)).toHaveLength(2);
  });

  it('keeps the tenant and tombstone terms', async () => {
    await runChurn(REP);
    const [probe] = contactProbes();
    expect(probe.sql).toMatch(/"contacts"\."tenant_id"/i);
    expect(probe.sql).toMatch(/"contacts"\."deleted_at" IS NULL/i);
    expect(probe.params).toContain(TENANT);
  });
});

describe('the rules leave alone the callers who hold them (#2777)', () => {
  it('the deal owner still gets a probability and their forecast', async () => {
    const res = await runForecast(REP, { assignedTo: MINE });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.probability).toBe(0.42);
    expect(json.forecast?.predictedValue).toBe('4000');
    expect(rpcCalls).toBe(1);
  });

  it('a created-by match counts as ownership too', async () => {
    const res = await runChurn(REP, { createdBy: MINE });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    expect(json.prediction?.churnRisk).toBe('high');
  });

  it('a deals.view_all holder keeps the tenant-wide read, byte for byte', async () => {
    const res = await runForecast(MANAGER);
    expect(res.status, await bodyOf(res)).toBe(200);
    const [probe] = dealProbes();
    expect(probe.sql).not.toMatch(dealOwnerClause);
    expect(probe.params).not.toContain(MINE);
    expect(probe.params).toEqual([DEAL, TENANT]);
  });

  it('a contacts.view_all holder likewise', async () => {
    const res = await runChurn(MANAGER);
    expect(res.status, await bodyOf(res)).toBe(200);
    const [probe] = contactProbes();
    expect(probe.sql).not.toMatch(contactOwnerClause);
    expect(probe.params).toEqual([CONTACT, TENANT]);
  });
});
