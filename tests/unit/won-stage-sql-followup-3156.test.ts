/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3156 — the four SQL sites #3120 left on `main` after #3146 landed the
 * resolver, each with its own private idea of "which stage ends a deal":
 *
 *  - `widgets/stats/pipeline`: `LOWER(name) LIKE '%won%' OR … '%lost%'` over a
 *    `deal_stages` sub-select keyed on `deal_stages.tenant_id`. The substring
 *    rule sweeps the negations #658 exists to refuse (`Not Won`, `Unwon`,
 *    `Wonderful Prospect`), so those deals were subtracted from open pipeline and
 *    the tile answered low on both `total` and `openDealsCount`.
 *  - `widgets/deals/closing`: `lower(ds.name) IN ('won', 'lost')` — the opposite
 *    failure. A `Closed Won` tenant's won deals matched nothing, so the widget
 *    kept listing deals that closed months ago.
 *  - `reports/deal-velocity`: `LOWER(name) IN ('won','closed won')` twice (the
 *    `avg_days_to_close` WHERE and the `conversion_rate` FILTER) and a fourth
 *    list for the terminal set, with no tenant predicate in any of them — so the
 *    won set was the union of EVERY tenant's `won`/`closed won` stages, and the
 *    two lists were maintained independently and could drift from each other.
 *
 * All three now read one classification of this tenant's own stages and compare
 * IDS. These tests are DB-free and pin the whole contract:
 *  - which ids reach the predicate — the accepted names, never a refused label;
 *  - that the vocabulary left SQL entirely: no emitted statement mentions
 *    `deal_stages`, `ILIKE` or a `LIKE` at all, and the stage read carries no
 *    name comparison (the resolver projects the name, the JS judges it);
 *  - that one request performs exactly one stage read;
 *  - that the empty sets stay APPLIED: `inArray(col, [])` renders `false` and
 *    `notInArray(col, [])` renders `true` (#3146 re-verified both against this
 *    repo's drizzle-orm), which answers "no won deals" and "nothing to exclude"
 *    instead of silently dropping the filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuid = (n: string) => `11111111-1111-4111-8111-00000000${n}`;

const WON = uuid('01');          // 'Closed Won'         — accepted
const WON_PLAIN = uuid('02');    // 'Won'                — accepted
const NOT_WON = uuid('03');      // 'Not Won'            — refused; `LIKE '%won%'` loved it
const UNWON = uuid('04');        // 'Unwon'              — refused
const WONDERFUL = uuid('05');    // 'Wonderful Prospect' — refused
const LOST = uuid('06');         // 'Closed Lost'        — terminal, not a win
const PROPOSAL = uuid('07');     // 'Proposal'           — open
const NOT_LOST = uuid('08');     // 'Not Lost'           — refused
const dialect = new PgDialect({} as never);

type Captured = { sql: string; params: unknown[]; keys: string[] };
let stageRows: { id: string; name: string }[] = [];
let wheres: Captured[] = [];
let executed: Captured[] = [];

/**
 * Rows dispatched on the PROJECTION, as #3120's harness does — three of these
 * routes issue more than one `db.select`, and a route that reorders its queries
 * must not silently change what the stub answers.
 */
function rowsFor(keys: string[]): unknown[] {
  const shape = keys.join(',');
  if (shape === 'id,name') return stageRows;
  if (shape === 'total,openDealsCount') return [{ total: 9000, openDealsCount: 4 }];
  if (shape === 'id,title,value,stage,closeDate') return [{ id: uuid('20'), title: 'Deal', value: 100, stage: 'Proposal', closeDate: null }];
  if (shape === 'stageId,stageName,count,totalValue') return [{ stageId: PROPOSAL, stageName: 'Proposal', count: 4, totalValue: '9000.00' }];
  return [];
}

function rowsForExecute(sqlText: string): Record<string, unknown>[] {
  if (/AS avg_days/i.test(sqlText)) return [{ avg_days: '6.5' }];
  if (/AS won\b/i.test(sqlText)) return [{ won: 2, total: 5 }];
  if (/AS count/i.test(sqlText)) return [{ count: 3 }];
  if (/AS total/i.test(sqlText)) return [{ total: '1234.50' }];
  return [];
}

function makeBuilder(keys: string[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'leftJoin', 'orderBy', 'groupBy', 'having', 'limit']) {
    b[m] = () => b;
  }
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
const pipelineWidget = await import('@/app/api/tenant/dashboard/widgets/stats/pipeline/route');
const closingWidget = await import('@/app/api/tenant/dashboard/widgets/deals/closing/route');
const dealVelocity = await import('@/app/api/tenant/reports/deal-velocity/route');

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
const stageReads = () => wheres.filter((w) => shape(w.keys) === 'id,name');
const stageRead = () => stageReads()[0];
const stmtFor = (pattern: RegExp) => executed.find((e) => pattern.test(e.sql));
// `/AS total/i` is not enough to find the pipeline-value statement — the
// conversion-rate query aliases its denominator `total` too. `SUM(amount::numeric)`
// appears only in the one.
const pipelineValueStmt = () => stmtFor(/SUM\(amount::numeric\)/i);

/**
 * The rule the whole issue rests on: a route that resolves in JS must leave the
 * stage NAMES out of its SQL completely. `deal_stages` appearing in an emitted
 * statement means a word comparison came back.
 */
function expectNoVocabularyInSql(captured: Captured | undefined, label: string) {
  expect(captured, `${label} — nothing was emitted: ${[...wheres, ...executed].map((c) => c.sql).join('\n')}`).toBeTruthy();
  expect(captured!.sql, label).not.toMatch(/deal_stages/i);
  expect(captured!.sql, label).not.toMatch(/LIKE/i);
  expect(captured!.sql, label).not.toMatch(/'won'|'lost'/i);
}

async function get(path: string, route: { GET: (req: NextRequest) => Promise<Response> }) {
  return route.GET(request(path));
}

const MIXED = [
  { id: WON, name: 'Closed Won' },
  { id: LOST, name: 'Closed Lost' },
  { id: NOT_WON, name: 'Not Won' },
  { id: UNWON, name: 'Unwon' },
  { id: WONDERFUL, name: 'Wonderful Prospect' },
  { id: NOT_LOST, name: 'Not Lost' },
  { id: PROPOSAL, name: 'Proposal' },
];
const REFUSED = [NOT_WON, UNWON, WONDERFUL, NOT_LOST];

beforeEach(() => {
  stageRows = [];
  wheres = [];
  executed = [];
  mockDb.select.mockReset();
  mockDb.execute.mockReset();
  mockDb.select.mockImplementation((cols?: Record<string, unknown>) =>
    makeBuilder(cols ? Object.keys(cols) : []),
  );
  mockDb.execute.mockImplementation((fragment: unknown) => {
    const q = dialect.sqlToQuery(fragment as never);
    const sqlText = q.sql;
    executed.push({ sql: sqlText, params: q.params as unknown[], keys: ['execute'] });
    return Promise.resolve({ rows: rowsForExecute(sqlText) });
  });
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(AUTH);
});

describe('site 1 — GET /api/tenant/dashboard/widgets/stats/pipeline', () => {
  it('excludes only the endings: a renamed win is terminal, a refused label is open pipeline', async () => {
    stageRows = MIXED;
    const res = await get('/api/tenant/dashboard/widgets/stats/pipeline', pipelineWidget);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { total: 9000, openDealsCount: 4 } });

    const clause = whereFor('total,openDealsCount');
    expectNoVocabularyInSql(clause, 'the tile may not re-decide won/lost in SQL');
    expect(clause!.sql).toMatch(/"deals"\."stage_id" not in \(\$\d+, \$\d+\)/);
    expect(clause!.params).toContain(WON);
    expect(clause!.params).toContain(LOST);
    // At base the `LIKE '%won%'` subquery made all four of these terminal, which
    // is the direction this tile was wrong in: it under-counted open pipeline.
    for (const refused of REFUSED) {
      expect(clause!.params, `${refused} must not be excluded from open pipeline`).not.toContain(refused);
    }
    expect(clause!.params).not.toContain(PROPOSAL);
    expect(stageReads()).toHaveLength(1);
  });

  it('the stage read is scoped through pipelines.tenant_id, not deal_stages.tenant_id', async () => {
    stageRows = MIXED;
    const res = await get('/api/tenant/dashboard/widgets/stats/pipeline', pipelineWidget);
    expect(res.status).toBe(200);
    const read = stageRead();
    expect(read, wheres.map((w) => w.sql).join('\n')).toBeTruthy();
    expect(read!.sql).toMatch(/"pipelines"\."tenant_id" = \$\d+/);
    expect(read!.params).toEqual([TENANT]);
    // The resolver projects the name and classifies it in JS; the SQL must not
    // judge it. (`/name/i` would also catch the projected column, so this checks
    // the emitted predicate text, which carries no column reference at all.)
    expect(read!.sql).not.toMatch(/lower/i);
  });

  it('a tenant with no terminal stage keeps the term applied and excludes nothing', async () => {
    stageRows = [];
    const res = await get('/api/tenant/dashboard/widgets/stats/pipeline', pipelineWidget);
    expect(res.status).toBe(200);
    const clause = whereFor('total,openDealsCount')!;
    expect(clause.sql).toMatch(/\band true\b/);
    expect(clause.sql).toMatch(/"deals"\."tenant_id"/);
  });
});

describe('site 2 — GET /api/tenant/dashboard/widgets/deals/closing', () => {
  it('a Closed Won tenant gets its won deals out of the list', async () => {
    stageRows = MIXED;
    const res = await get('/api/tenant/dashboard/widgets/deals/closing', closingWidget);
    expect(res.status).toBe(200);
    expect((await res.json()).data.items).toHaveLength(1);

    const clause = whereFor('id,title,value,stage,closeDate');
    expectNoVocabularyInSql(clause, 'the widget may not spell the endings out in SQL');
    expect(clause!.sql).toMatch(/"deals"\."stage_id" not in \(\$\d+, \$\d+\)/);
    expect(clause!.params).toContain(WON);
    expect(clause!.params).toContain(LOST);
    for (const refused of REFUSED) {
      expect(clause!.params, `${refused} is an open deal and belongs in the list`).not.toContain(refused);
    }
    expect(stageReads()).toHaveLength(1);
  });

  it('a tenant with no terminal stage still renders the exclusion, as `true`', async () => {
    stageRows = [{ id: PROPOSAL, name: 'Proposal' }];
    const res = await get('/api/tenant/dashboard/widgets/deals/closing', closingWidget);
    expect(res.status).toBe(200);
    const clause = whereFor('id,title,value,stage,closeDate')!;
    expect(clause.sql).toMatch(/\band true\b/);
    expect(clause.params).not.toContain(PROPOSAL);
  });
});

describe('site 3 — GET /api/tenant/reports/deal-velocity', () => {
  it('one stage read feeds the three queries, and no statement touches deal_stages', async () => {
    stageRows = MIXED;
    const res = await get('/api/tenant/reports/deal-velocity', dealVelocity);
    expect(res.status).toBe(200);
    expect(stageReads(), 'one classification per request').toHaveLength(1);
    expect(executed).toHaveLength(4);
    for (const stmt of executed) {
      expectNoVocabularyInSql(stmt, 'the report may not decide the vocabulary in SQL');
      expect(stmt.params).toContain(TENANT);
    }

    const avg = stmtFor(/AS avg_days/i)!;
    expect(avg.sql).toMatch(/"deals"\."stage_id" in \(\$\d+\)/);
    expect(avg.params).toContain(WON);
    for (const refused of REFUSED) {
      expect(avg.params, `${refused} never closes a deal`).not.toContain(refused);
    }
    expect(avg.params).not.toContain(LOST);

    const counts = stmtFor(/AS won\b/i)!;
    expect(counts.sql).toMatch(/COUNT\(\*\) FILTER \(WHERE "deals"\."stage_id" in \(\$\d+\)\)/i);
    expect(counts.params).toContain(WON);
    expect(counts.params).not.toContain(LOST);

    const pipeline = pipelineValueStmt()!;
    expect(pipeline.sql).toMatch(/"deals"\."stage_id" not in \(\$\d+, \$\d+\)/);
    expect(pipeline.params).toContain(WON);
    expect(pipeline.params).toContain(LOST);
    for (const refused of REFUSED) {
      expect(pipeline.params, `${refused} is not terminal, so its value stays in the pipeline`).not.toContain(refused);
    }
  });

  it('the won set is this tenant\'s, so two pipelines both count', async () => {
    stageRows = [
      { id: WON, name: 'Closed Won' },
      { id: WON_PLAIN, name: 'Won' },
      { id: PROPOSAL, name: 'Proposal' },
    ];
    const res = await get('/api/tenant/reports/deal-velocity', dealVelocity);
    expect(res.status).toBe(200);
    const counts = stmtFor(/AS won\b/i)!;
    expect(counts.sql).toMatch(/"deals"\."stage_id" in \(\$\d+, \$\d+\)/);
    expect(counts.params).toContain(WON);
    expect(counts.params).toContain(WON_PLAIN);

    const json = await res.json();
    expect(json.data).toMatchObject({
      avg_days_to_close: 6.5,
      conversion_rate: 40,
      total_pipeline_value: 1234.5,
      deals_this_month: 3,
      won_deals: 2,
      total_deals: 5,
    });
    expect(json.data.stage_distribution).toEqual([{ stage: 'Proposal', count: 4, value: 9000 }]);
  });

  it('a tenant with no won stage answers 0 rather than counting every deal', async () => {
    stageRows = [{ id: PROPOSAL, name: 'Proposal' }, { id: LOST, name: 'Closed Lost' }];
    const res = await get('/api/tenant/reports/deal-velocity', dealVelocity);
    expect(res.status).toBe(200);

    // The won side renders the literal `false` — dropping the term would have
    // answered "every deal is a win" and reported conversion_rate: 100.
    expect(stmtFor(/AS avg_days/i)!.sql).toMatch(/\bAND false\b/i);
    expect(stmtFor(/AS won\b/i)!.sql).toMatch(/FILTER \(WHERE false\)/i);
    // The terminal side is won ∪ lost, so it still excludes `Closed Lost`.
    const pipeline = pipelineValueStmt()!;
    expect(pipeline.sql).toMatch(/"deals"\."stage_id" not in \(\$\d+\)/);
    expect(pipeline.params).toEqual(expect.arrayContaining([TENANT, LOST]));
    expect(pipeline.params).not.toContain(PROPOSAL);
  });

  it('the monthly and stage-distribution reads are untouched by the rewrite', async () => {
    stageRows = MIXED;
    const res = await get('/api/tenant/reports/deal-velocity', dealVelocity);
    expect(res.status).toBe(200);
    const monthly = stmtFor(/AS count/i)!;
    expect(monthly.sql).toMatch(/DATE_TRUNC\('month', CURRENT_DATE\)/i);
    expect(monthly.params).toEqual([TENANT]);
    expect(stageReads()).toHaveLength(1);
  });
});
