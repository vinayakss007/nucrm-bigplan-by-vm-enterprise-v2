/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3120 — three server routes each wrote their own SQL comparison for "which
 * deals are won", and none of them was `isWonStageName` (#658), the rule the
 * webhook, the bulk actions and — since #3118 — the two client pages use.
 *
 *  - `widgets/stats/revenue/route.ts`: `lower(name) = 'won'` + `.limit(1)` —
 *    a renamed `Closed Won` stage resolved to nothing (tile: 0, while the deals
 *    list, the leaderboards and the analytics page all said otherwise), and a
 *    two-pipeline workspace counted whichever `Won` row Postgres returned first.
 *  - `dashboard/stats/route.ts`: `lower(name) IN ('won','lost')` for the terminal
 *    set (capped at 20 rows) plus a second, exact `lower(ds.name) = 'won'`
 *    subquery for `won_this_month`, and the
 *    `terminalStageIds.length > 0 ? [notInArray(…)] : []` splice, which turned
 *    "this tenant has no stage spelled 'Won'/'Lost'" into "nothing is ever
 *    closed" — so the Upcoming Deals widget listed deals that closed months ago.
 *  - `reports/win-loss/route.ts`: `ds.name ILIKE '%won%'` / `'%lost%'`, a
 *    substring match that counts precisely the labels the matcher exists to
 *    refuse (`Not Won`, `Unwon`, `Wonderful Prospect`, `Not Lost`) in the won and
 *    lost counts, in the monthly trend, and in the closed denominator.
 *
 * The fix is one vocabulary: `lib/deals/won-stage-ids.ts` reads a tenant's
 * stages, classifies them with #658, and the routes compare the resulting IDS in
 * SQL. These tests are DB-free, so they pin both halves of that contract:
 *  - which ids a route binds into the predicate. The stubbed stage read hands
 *    back the tenant's stage rows, so a route that classifies in JS binds the
 *    rows #658 calls a win — and, unlike the base, not the first row it happened
 *    to get, nor a label it should refuse;
 *  - that an EMPTY id set stays APPLIED. `inArray(col, [])` renders the literal
 *    `false` and `notInArray(col, [])` the literal `true` (both re-verified here
 *    against `PgDialect.sqlToQuery` on this repo's drizzle-orm 0.45.4), which is
 *    "no deals match" for the inclusion sites and "nothing to exclude" for the
 *    exclusion site — either way a real answer, never a dropped filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { inArray, notInArray } from 'drizzle-orm';
import { deals } from '@/drizzle/schema';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuid = (n: string) => `11111111-1111-4111-8111-00000000${n}`;

/** One tenant's pipeline, named the way #658 accepts and refuses them. */
const WON = uuid('01');          // 'Closed Won'         — accepted
const WON_PLAIN = uuid('02');    // 'Won'                — accepted
const NOT_WON = uuid('03');      // 'Not Won'            — refused, but `ILIKE '%won%'` loved it
const UNWON = uuid('04');        // 'Unwon'              — refused
const WONDERFUL = uuid('05');    // 'Wonderful Prospect' — refused
const LOST = uuid('06');         // 'Closed Lost'        — terminal, not a win
const PROPOSAL = uuid('07');     // 'Proposal'           — open
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; keys: string[] };
let stageRows: { id: string; name: string }[] = [];
let wheres: Captured[] = [];
let executed: Captured[] = [];
let limits: { keys: string[]; n: unknown }[] = [];
let revenueTotal: number | string = 42000;
let countsRows: Record<string, unknown>[] = [];
let winLossRows: Record<string, unknown>[] = [];

/**
 * Rows for a `db.select(...)`, dispatched on the PROJECTION rather than the call
 * order — a route that reorders its queries (as `dashboard/stats` now does) must
 * not silently change what the stub answers. `id,name` is the stage read added
 * by #3120; `total` is the revenue tile's SUM.
 */
function rowsFor(keys: string[]): unknown[] {
  const shape = keys.join(',');
  if (shape === 'id,name') return stageRows;
  if (shape === 'total') return [{ total: revenueTotal }];
  return [];
}

function makeBuilder(keys: string[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'groupBy', 'having']) {
    b[m] = () => b;
  }
  b['limit'] = (n: unknown) => {
    limits.push({ keys, n });
    return b;
  };
  b['where'] = (predicate: unknown) => {
    const q = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: q.sql, params: q.params as unknown[], keys });
    return b;
  };
  b['then'] = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(rowsFor(keys)).then(ok, err);
  return b;
}

const mockDb = { select: vi.fn(), execute: vi.fn() };

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: () => ({}),
}));
vi.mock('@/lib/api-error', () => ({
  apiError: (err: unknown) => Response.json({ error: String(err) }, { status: 500 }),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/dashboard/widget-cache', () => ({
  withCache: (_t: string, _k: string, _ttl: number, fetcher: () => Promise<Response>) => fetcher(),
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const revenue = await import('@/app/api/tenant/dashboard/widgets/stats/revenue/route');
const stats = await import('@/app/api/tenant/dashboard/stats/route');
const winLoss = await import('@/app/api/tenant/reports/win-loss/route');
const {
  resolveDealStageIds,
  resolveWonStageIds,
  resolveTerminalStageIds,
} = await import('@/lib/deals/won-stage-ids');

const AUTH = {
  userId: MINE, tenantId: TENANT, roleSlug: 'manager',
  permissions: { 'deals.view': true, 'deals.view_all': true, 'contacts.view': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

function request(path: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

const shape = (keys: string[]) => keys.join(',');
const whereFor = (of: string) => wheres.find((w) => shape(w.keys) === of);
const stageRead = () => whereFor('id,name');
const combinedStats = () => executed.find((e) => /AS won_this_month/.test(e.sql));

/** The stage read may not re-decide the vocabulary: it selects, it does not judge. */
function expectNoStageNameComparison(sqlText: string | undefined, label: string) {
  expect(sqlText, `${label}: ${wheres.map((w) => w.sql).join('\n')}`).toBeTruthy();
  expect(sqlText!, label).not.toMatch(/name/i);
  expect(sqlText!, label).not.toMatch(/ILIKE/i);
}

async function getRevenue() {
  return (revenue.GET as (req: NextRequest) => Promise<Response>)(
    request('/api/tenant/dashboard/widgets/stats/revenue'),
  );
}
async function getStats() {
  return (stats.GET as (req: NextRequest) => Promise<Response>)(
    request('/api/tenant/dashboard/stats'),
  );
}
async function getWinLoss() {
  return (winLoss.GET as (req: NextRequest) => Promise<Response>)(
    request('/api/tenant/reports/win-loss'),
  );
}

const RENAMED_WIN_LOSS = [
  { id: WON, name: 'Closed Won' },
  { id: LOST, name: 'Closed Lost' },
  { id: PROPOSAL, name: 'Proposal' },
];
const REFUSALS = [
  { id: NOT_WON, name: 'Not Won' },
  { id: UNWON, name: 'Unwon' },
  { id: WONDERFUL, name: 'Wonderful Prospect' },
];

beforeEach(() => {
  stageRows = [];
  wheres = [];
  executed = [];
  limits = [];
  revenueTotal = 42000;
  countsRows = [];
  winLossRows = [{
    won: 1, lost: 1, total_closed: 2,
    avg_won_value: '5000.00', avg_lost_value: '1000.00',
    avg_days_to_win: '4.0', avg_days_to_lose: '9.0',
  }];
  mockDb.select.mockReset();
  mockDb.execute.mockReset();
  mockDb.select.mockImplementation((cols?: Record<string, unknown>) =>
    makeBuilder(cols ? Object.keys(cols) : []),
  );
  mockDb.execute.mockImplementation((fragment: unknown) => {
    const q = dialect.sqlToQuery(fragment as never);
    const sqlText = q.sql;
    executed.push({ sql: sqlText, params: q.params as unknown[], keys: ['execute'] });
    const rows = /total_closed/.test(sqlText) ? winLossRows
      : /AS won_this_month/.test(sqlText) ? countsRows
        : [];
    return Promise.resolve({ rows });
  });
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(AUTH);
});

describe('site 1 — GET /api/tenant/dashboard/widgets/stats/revenue', () => {
  it('a renamed winning stage counts its money, and a refused label never becomes the won stage', async () => {
    stageRows = [...REFUSALS.slice(0, 1), { id: WON, name: 'Closed Won' }, { id: PROPOSAL, name: 'Proposal' }];
    const res = await getRevenue();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { wonThisMonth: 42000 } });

    const clause = whereFor('total');
    expect(clause, wheres.map((w) => w.sql).join('\n')).toBeTruthy();
    expect(clause!.sql).toMatch(/"deals"\."stage_id" in \(\$\d+\)/);
    // The id bound as the won stage is the one #658 accepts — not the first row
    // the read handed back, which here is the refusal `Not Won` (what
    // `.limit(1)` + `rows[0]` at base would have picked).
    expect(clause!.params).toContain(WON);
    expect(clause!.params).not.toContain(NOT_WON);
    expect(clause!.params).not.toContain(PROPOSAL);
    expectNoStageNameComparison(stageRead()?.sql, 'the stage read may not judge names in SQL');
  });

  it('two pipelines with a won stage each: both count (the .limit(1) pin)', async () => {
    stageRows = [{ id: WON_PLAIN, name: 'Won' }, { id: WON, name: 'Closed Won' }, { id: PROPOSAL, name: 'Proposal' }];
    const res = await getRevenue();
    expect(res.status).toBe(200);
    const clause = whereFor('total')!;
    expect(clause.params).toContain(WON_PLAIN);
    expect(clause.params).toContain(WON);
    expect(clause.sql).toMatch(/"deals"\."stage_id" in \(\$\d+, \$\d+\)/);
    // No cap on the stage read: a capped read answers "one pipeline out of N".
    expect(limits.filter((l) => shape(l.keys) === 'id,name')).toEqual([]);
  });

  it('a tenant with no winning stage keeps the filter applied and answers 0', async () => {
    stageRows = [{ id: PROPOSAL, name: 'Proposal' }, { id: NOT_WON, name: 'Not Won' }];
    revenueTotal = 0;
    const res = await getRevenue();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { wonThisMonth: 0 } });

    const clause = whereFor('total');
    expect(clause, 'the aggregate must still run, with the won term applied').toBeTruthy();
    expect(clause!.sql).toMatch(/\bAND false\b/i);
    expect(clause!.sql).toMatch(/"deals"\."tenant_id"/);
    expect(clause!.params).not.toContain(PROPOSAL);
    expect(clause!.params).not.toContain(NOT_WON);
  });
});

describe('site 2 — GET /api/tenant/dashboard/stats', () => {
  it('won_this_month selects the winning stage by id, so a renamed stage is not 0', async () => {
    stageRows = RENAMED_WIN_LOSS;
    countsRows = [{ won_this_month: '42000', total_deals: 3, contact_count: 1 }];
    const res = await getStats();
    expect(res.status).toBe(200);
    expect((await res.json()).data.wonThisMonth).toBe(42000);

    const combined = combinedStats();
    expect(combined, executed.map((e) => e.sql).join('\n')).toBeTruthy();
    expect(combined!.sql).toMatch(/"deals"\."stage_id" in \(\$\d+\)/);
    expect(combined!.params).toContain(WON);
    expect(combined!.params).not.toContain(LOST);
    expect(combined!.params).not.toContain(PROPOSAL);
    expect(combined!.sql).not.toMatch(/lower\(ds\.name\) = 'won'/);
    // #3112's month keying survives the rewrite.
    expect(combined!.sql).toMatch(/COALESCE\(won_at, created_at\) >= date_trunc\('month', now\(\)\)/i);
  });

  it('Upcoming Deals excludes both endings of a renamed pipeline', async () => {
    stageRows = RENAMED_WIN_LOSS;
    const res = await getStats();
    expect(res.status).toBe(200);
    const clause = whereFor('id,title,amount,closeDate,stageName');
    expect(clause, wheres.map((w) => w.sql).join('\n')).toBeTruthy();
    expect(clause!.sql).toMatch(/"deals"\."stage_id" not in \(\$\d+, \$\d+\)/);
    expect(clause!.params).toContain(WON);
    expect(clause!.params).toContain(LOST);
    expect(clause!.params).not.toContain(PROPOSAL);
    expectNoStageNameComparison(stageRead()?.sql, 'the terminal set may not be spelled out in SQL');
    expect(limits.filter((l) => shape(l.keys) === 'id,name')).toEqual([]);
  });

  it('a tenant with nothing terminal still applies both terms — no fallback to "no filter"', async () => {
    stageRows = [];
    const res = await getStats();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.wonThisMonth).toBe(0);

    const clause = whereFor('id,title,amount,closeDate,stageName')!;
    // `notInArray(col, [])` renders `true`: nothing is terminal, so nothing is
    // excluded. The base dropped the whole term behind `length > 0`, which is
    // the same SQL result but the wrong rule — it read "no stage matched the
    // literal words" as "nothing is ever closed".
    expect(clause.sql).toMatch(/\band true\b/);
    expect(combinedStats()!.sql).toMatch(/\bAND false\b/i);
  });

  it('a tenant whose stages are all refusals excludes nothing and wins nothing', async () => {
    stageRows = REFUSALS;
    const res = await getStats();
    expect(res.status).toBe(200);
    expect(whereFor('id,title,amount,closeDate,stageName')!.sql).toMatch(/\band true\b/);
    const combined = combinedStats()!;
    expect(combined.sql).toMatch(/\bAND false\b/i);
    expect(combined.params).not.toContain(NOT_WON);
    expect(combined.params).not.toContain(UNWON);
    expect(combined.params).not.toContain(WONDERFUL);
  });
});

describe('site 3 — GET /api/tenant/reports/win-loss', () => {
  const MIXED = [...RENAMED_WIN_LOSS, ...REFUSALS];

  it('the labels #658 refuses are neither won nor closed — they never reach the SQL', async () => {
    stageRows = MIXED;
    const res = await getWinLoss();
    expect(res.status).toBe(200);
    expect(executed).toHaveLength(2);
    for (const stmt of executed) {
      expect(stmt.sql, stmt.sql).not.toMatch(/ILIKE/i);
      expect(stmt.sql).toMatch(/"ds"\."id" in \(\$\d+\)/);
      for (const refused of [NOT_WON, UNWON, WONDERFUL]) {
        expect(stmt.params, `${refused} must not be bound anywhere`).not.toContain(refused);
      }
      expect(stmt.params).toContain(TENANT);
    }
    // won: 3 aggregate FILTERs + the closed WHERE; lost: the same.
    const statsStmt = executed.find((e) => /total_closed/.test(e.sql))!;
    expect(statsStmt.params.filter((p) => p === WON)).toHaveLength(4);
    expect(statsStmt.params.filter((p) => p === LOST)).toHaveLength(4);

    const json = await res.json();
    expect(json.data.won_deals).toBe(1);
    expect(json.data.total_closed).toBe(2);
  });

  it('the monthly trend aggregates over the same id sets', async () => {
    stageRows = MIXED;
    const res = await getWinLoss();
    expect(res.status).toBe(200);
    const monthly = executed.find((e) => /TO_CHAR/.test(e.sql))!;
    expect(monthly.sql).not.toMatch(/ILIKE/i);
    expect(monthly.sql).toMatch(/"ds"\."id" in \(\$\d+, \$\d+\)/);
    expect(monthly.params).toContain(WON);
    expect(monthly.params).toContain(LOST);
    expect(monthly.params).not.toContain(UNWON);
    expect(monthly.params.filter((p) => p === WON)).toHaveLength(2);
  });

  it('a tenant with no won/lost stage reports 0 closed instead of counting every deal', async () => {
    stageRows = [{ id: PROPOSAL, name: 'Proposal' }];
    winLossRows = [{ won: 0, lost: 0, total_closed: 0 }];
    const res = await getWinLoss();
    expect(res.status).toBe(200);
    expect(executed).toHaveLength(2);
    for (const stmt of executed) {
      expect(stmt.sql).toMatch(/\bAND false\b/i);
      expect(stmt.params).not.toContain(PROPOSAL);
    }
    const json = await res.json();
    expect(json.data.total_closed).toBe(0);
    expect(json.data.win_rate).toBe(0);
  });
});

describe('the shared resolvers — one vocabulary the SQL can reach (#658)', () => {
  /** A `Pick<DbClient,'select'>` stub: the helper builds its own query chain. */
  function execWith(rows: { id: string; name: string }[]) {
    const select = vi.fn(() => makeBuilder(['id', 'name']));
    stageRows = rows;
    return { exec: { select } as never, select };
  }

  it('accepts the winning names in any case, and only them', async () => {
    const stub = execWith([
      { id: uuid('11'), name: 'WON' },
      { id: uuid('12'), name: 'Closed Won' },
      { id: uuid('13'), name: '  deal won  ' },
      { id: uuid('14'), name: 'Marked Won' },
      { id: uuid('15'), name: 'Sale Won' },
      { id: uuid('16'), name: 'Proposal' },
    ]);
    expect(await resolveWonStageIds(stub.exec, TENANT)).toEqual([
      uuid('11'), uuid('12'), uuid('13'), uuid('14'), uuid('15'),
    ]);
  });

  it('refuses Lost, Not Won, Unwon and Wonderful Prospect', async () => {
    const stub = execWith([
      { id: NOT_WON, name: 'Not Won' },
      { id: UNWON, name: 'Unwon' },
      { id: WONDERFUL, name: 'Wonderful Prospect' },
      { id: PROPOSAL, name: 'Proposal' },
    ]);
    expect(await resolveWonStageIds(stub.exec, TENANT)).toEqual([]);
    expect(await resolveTerminalStageIds(stub.exec, TENANT)).toEqual([]);
  });

  it('terminal is won ∪ lost, and the empty case is empty — not "everything"', async () => {
    const stub = execWith([
      { id: PROPOSAL, name: 'Proposal' },
      { id: WON, name: 'Closed Won' },
      { id: LOST, name: 'Closed Lost' },
      { id: NOT_WON, name: 'Not Won' },
    ]);
    const sets = await resolveDealStageIds(stub.exec, TENANT);
    expect(sets.won).toEqual([WON]);
    expect(sets.lost).toEqual([LOST]);
    expect(sets.terminal).toEqual([WON, LOST]);
    expect(await resolveTerminalStageIds(stub.exec, TENANT)).toEqual(sets.terminal);

    const empty = execWith([]);
    expect((await resolveDealStageIds(empty.exec, TENANT)).terminal).toEqual([]);
  });

  it('the read is tenant-scoped, uncapped, and projects the name it classifies', async () => {
    const stub = execWith([{ id: WON, name: 'Closed Won' }]);
    await resolveWonStageIds(stub.exec, TENANT);
    const projection = stub.select.mock.calls[0]![0] as Record<string, { name?: string }>;
    expect(Object.keys(projection)).toEqual(['id', 'name']);
    expect(String(projection.name?.name)).toBe('name');
    expect(String(projection.id?.name)).toBe('id');
    const read = stageRead();
    expect(read!.sql).toMatch(/"pipelines"\."tenant_id" = \$\d+/);
    expect(read!.params).toEqual([TENANT]);
    expect(limits.filter((l) => shape(l.keys) === 'id,name')).toEqual([]);
  });

  it('the two empty-set renderings the routes lean on are literals, not a dropped filter', () => {
    // Re-verified against this repo's drizzle-orm 0.45.4, as #3120 asks: an
    // empty id list is an answer, so it must never be spliced away.
    expect(dialect.sqlToQuery(inArray(deals.stageId, [])).sql).toBe('false');
    expect(dialect.sqlToQuery(notInArray(deals.stageId, [])).sql).toBe('true');
    expect(dialect.sqlToQuery(inArray(deals.stageId, [WON])).sql).toBe('"deals"."stage_id" in ($1)');
  });
});
