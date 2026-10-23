/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3112 — "Revenue won this month" is bucketed by the day the deal was created.
 *
 * Both readers of the tile key the month window on `deals.created_at`
 * (`widgets/stats/revenue/route.ts:54`, `dashboard/stats/route.ts:66`) while the
 * row is also required to sit in a won stage *now*. So the quantity computed is
 * "deals created this month that are currently won", and a deal created in
 * September and won in October is missing from October. `deals.won_at`
 * (`drizzle/schema/crm.ts:337`, migration 0084, backfilled from
 * `metadata->>'won_at'`, indexed `idx_deals_won_at`) is the column that answers
 * the question the tile asks — but at `0256037e2` exactly one writer sets it:
 * `handleDealWon` via `deals/[id]/route.ts:437`. The bulk "move stage" and bulk
 * "close … outcome: won" actions (`deals/bulk/route.ts:182`, `:229`) win deals
 * and record nothing.
 *
 * So the fix is two halves, and each is asserted here as the other's
 * precondition:
 *  - the window keys on the recorded win, falling back to `created_at`, which is
 *    a provable lower bound (a deal cannot be won before it exists) and so can
 *    only ever match today's answer, never a worse one;
 *  - the bulk route records `won_at` for the wins it creates, using the
 *    renamed-stage matcher `isWonStageName` that #658 introduced for the
 *    side-effects — otherwise the fallback keeps silently hiding bulk wins.
 *
 * `deals_this_month_value` and `new_contacts_this_month` genuinely mean *created
 * this month*; they are pinned here so a future keying fix does not sweep them
 * into the change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAGE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const dialect = new PgDialect({} as never);

const { mockUpdate, mockEnforceFieldWrite, mockReadJsonBody } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockEnforceFieldWrite: vi.fn(),
  mockReadJsonBody: vi.fn(),
}));

let wheres: { sql: string; params: unknown[] }[] = [];
let executed: { sql: string; params: unknown[] }[] = [];
let cacheArgs: string[] = [];

function selectChain(rows: unknown[], onWhere?: (predicate: unknown) => void) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'having', 'limit']) {
    b[m] = () => b;
  }
  b['where'] = (predicate: unknown) => {
    const rendered = dialect.sqlToQuery(predicate as never);
    wheres.push({ sql: rendered.sql, params: rendered.params });
    onWhere?.(predicate);
    return b;
  };
  b['then'] = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(ok, err);
  return b;
}

function updateChain(capture: (patch: Record<string, unknown>) => void) {
  return {
    set: (patch: Record<string, unknown>) => {
      capture(patch);
      return { where: () => Promise.resolve({ rowCount: 1 }) };
    },
  };
}

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
    execute: vi.fn(),
    update: mockUpdate,
    transaction: vi.fn(),
  },
}));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/api/middleware/require-perm', () => ({ requirePerm: vi.fn(() => null) }));
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: () => ({}),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/validate', () => ({ readJsonBody: mockReadJsonBody }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/dashboard/widget-cache', () => ({
  withCache: (_t: string, _key: string, _ttl: number, fetcher: () => Promise<Response>, scopeKey?: string) => {
    cacheArgs.push(String(scopeKey));
    return fetcher();
  },
}));
vi.mock('@/lib/rbac/enforce', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/rbac/enforce')>();
  return { ...orig, enforceFieldWrite: mockEnforceFieldWrite };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const { db } = await import('@/drizzle/db');
const revenue = await import('@/app/api/tenant/dashboard/widgets/stats/revenue/route');
const stats = await import('@/app/api/tenant/dashboard/stats/route');
const bulk = await import('@/app/api/tenant/deals/bulk/route');

const AUTH = {
  userId: MINE, tenantId: TENANT, roleSlug: 'manager',
  permissions: { 'deals.view': true, 'deals.view_all': true, 'deals.edit': true, 'contacts.view': true },
  isAdmin: false, isSuperAdmin: false,
} as unknown as AuthContext;

function get(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

const dealsClause = () => wheres.find((w) => /"deals"\."stage_id"/.test(w.sql));

/** The subquery that produces `alias`, from the rendered combined-stats SQL. */
function subquery(rendered: string, alias: string): string {
  const at = rendered.indexOf(`AS ${alias}`);
  expect(at, `no ${alias} in ${rendered}`).toBeGreaterThan(-1);
  const start = rendered.lastIndexOf('(SELECT', at);
  return rendered.slice(start, at + alias.length + 3);
}

beforeEach(() => {
  wheres = [];
  executed = [];
  cacheArgs = [];
  mockUpdate.mockReset();
  mockEnforceFieldWrite.mockReset();
  (db.select as ReturnType<typeof vi.fn>).mockReset();
  (db.execute as ReturnType<typeof vi.fn>).mockReset();
  (db.execute as ReturnType<typeof vi.fn>).mockImplementation((fragment: unknown) => {
    executed.push(dialect.sqlToQuery(fragment as never));
    return Promise.resolve({ rows: [] });
  });
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(AUTH);
});

describe('site 1 — GET /api/tenant/dashboard/widgets/stats/revenue keys the month on the win', () => {
  async function runRevenue() {
    // #3120: the tile's stage read now projects {id, name} and classifies the
    // name with isWonStageName, so the stub row carries the name the real query
    // would have returned.
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => selectChain([{ id: STAGE, name: 'Won' }]))
      .mockImplementation(() => selectChain([{ total: 42000 }]));
    return (revenue.GET as (req: NextRequest) => Promise<Response>)(
      get('/api/tenant/dashboard/widgets/stats/revenue'),
    );
  }

  it('buckets SUM(amount) by coalesce(won_at, created_at), not by created_at alone', async () => {
    const res = await runRevenue();
    expect(res.status, await res.text()).toBe(200);
    const clause = dealsClause();
    expect(clause, wheres.map((w) => w.sql).join('\n')).toBeTruthy();
    expect(clause!.sql).toMatch(/coalesce\(\s*"deals"\."won_at",\s*"deals"\."created_at"\s*\)/i);
    expect(clause!.sql).toMatch(/date_trunc\('month', now\(\)\)/);
    expect(clause!.sql).not.toMatch(/"deals"\."created_at" >= date_trunc/i);
  });

  it('keeps every term the tile already had — won stage, tombstone, archive — and the caller scope', async () => {
    const res = await runRevenue();
    expect(res.status).toBe(200);
    const clause = dealsClause()!;
    expect(clause.sql).toMatch(/"deals"\."stage_id"/);
    expect(clause.sql).toMatch(/"deals"\."deleted_at"/i);
    expect(clause.sql).toMatch(/'archived'/);
    expect(clause.sql).toMatch(/"deals"\."tenant_id"/);
    expect(cacheArgs).toEqual(['tenant']);
  });

  it('still answers with the wonThisMonth the query returned', async () => {
    const res = await runRevenue();
    expect(await res.json()).toEqual({ data: { wonThisMonth: 42000 } });
  });
});

describe('site 2 — the combined dashboard stats subquery is fixed the same way', () => {
  async function runStats() {
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => selectChain([]));
    return (stats.GET as (req: NextRequest) => Promise<Response>)(get('/api/tenant/dashboard/stats'));
  }

  it('won_this_month reads coalesce(won_at, created_at)', async () => {
    const res = await runStats();
    expect(res.status, await res.text()).toBe(200);
    const combined = executed.find((e) => /AS won_this_month/.test(e.sql));
    expect(combined, executed.map((e) => e.sql).join('\n')).toBeTruthy();
    const won = subquery(combined!.sql, 'won_this_month');
    expect(won).toMatch(/COALESCE\(won_at, created_at\) >= date_trunc\('month', now\(\)\)/i);
    expect(won).not.toMatch(/[^_]created_at >= date_trunc/i);
  });

  it('leaves the two metrics that genuinely mean "created this month" on created_at', async () => {
    const res = await runStats();
    expect(res.status).toBe(200);
    const combined = executed.find((e) => /AS deals_this_month_value/.test(e.sql))!;
    for (const alias of ['deals_this_month_value', 'new_contacts_this_month']) {
      const seg = subquery(combined.sql, alias);
      expect(seg).toMatch(/created_at >= date_trunc\('month', now\(\)\)/);
      expect(seg).not.toMatch(/COALESCE\(won_at/i);
    }
  });

  it('the pipeline_total / total_deals terms gain no month filter', async () => {
    const res = await runStats();
    expect(res.status).toBe(200);
    const combined = executed.find((e) => /AS pipeline_total/.test(e.sql))!;
    expect(subquery(combined.sql, 'pipeline_total')).not.toMatch(/date_trunc/);
    expect(subquery(combined.sql, 'total_deals')).not.toMatch(/date_trunc/);
  });
});

describe('site 3 — bulk "stage"/"close" records the win it causes', () => {
  async function post(body: unknown, stageName: string | null) {
    const sets: Record<string, unknown>[] = [];
    mockUpdate.mockImplementation(() => updateChain((patch) => sets.push(patch)));
    mockEnforceFieldWrite.mockImplementation(
      async (_c: unknown, _e: string, b: Record<string, unknown>) => ({ body: { ...b }, stripped: [] }),
    );
    let call = 0;
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() =>
      selectChain(call++ === 0 ? [{ id: 'd1' }] : [{ id: 'S1', name: stageName }]),
    );
    mockReadJsonBody.mockResolvedValue(body);
    const res = await bulk.POST(
      new Request('http://localhost/api/tenant/deals/bulk', { method: 'POST', body: '{}' }) as never,
    );
    return { res, sets };
  }

  it('moving to a won stage writes won_at in the same update', async () => {
    const { res, sets } = await post({ action: 'stage', deal_ids: ['d1'], payload: { stage_id: 'S1' } }, 'Closed Won');
    expect(res.status, await res.text()).toBe(200);
    expect(sets).toHaveLength(1);
    expect(sets[0].stageId).toBe('S1');
    expect(sets[0].wonAt).toBeInstanceOf(Date);
  });

  it('bulk close with outcome won writes won_at, and keeps the metadata patch', async () => {
    const { res, sets } = await post(
      { action: 'close', deal_ids: ['d1'], payload: { stage_id: 'S1', outcome: 'won', reason: 'signed' } },
      'Won',
    );
    expect(res.status, await res.text()).toBe(200);
    expect(sets[0].wonAt).toBeInstanceOf(Date);
    expect(sets[0].closeDate).toBeInstanceOf(Date);
    expect(sets[0].metadata).toBeTruthy();
  });

  it('an ordinary stage records nothing: no won_at key at all', async () => {
    const { res, sets } = await post({ action: 'stage', deal_ids: ['d1'], payload: { stage_id: 'S1' } }, 'Negotiation');
    expect(res.status).toBe(200);
    expect(sets[0]).not.toHaveProperty('wonAt');
  });

  it('a lost stage does not count as a win, and neither does an unresolvable name', async () => {
    for (const name of ['Closed Lost', 'Not Won', null]) {
      const { sets } = await post({ action: 'stage', deal_ids: ['d1'], payload: { stage_id: 'S1' } }, name);
      expect(sets[0], String(name)).not.toHaveProperty('wonAt');
    }
  });

  it('the won matcher is the same one the deal-won side-effects use (#658)', async () => {
    for (const name of ['won', 'DEAL WON', 'Closed - Won']) {
      const { sets } = await post({ action: 'stage', deal_ids: ['d1'], payload: { stage_id: 'S1' } }, name);
      expect(sets[0].wonAt, name).toBeInstanceOf(Date);
    }
  });

  it('the stage lookup carries the name, since the won decision depends on it', async () => {
    const projections: Record<string, string>[] = [];
    mockUpdate.mockImplementation(() => updateChain(() => undefined));
    mockEnforceFieldWrite.mockImplementation(
      async (_c: unknown, _e: string, b: Record<string, unknown>) => ({ body: { ...b }, stripped: [] }),
    );
    (db.select as ReturnType<typeof vi.fn>).mockImplementation((cols?: unknown) => {
      if (cols) {
        projections.push(
          Object.fromEntries(
            Object.entries(cols as Record<string, unknown>).map(([key, col]) => [key, String((col as { name?: unknown }).name)]),
          ),
        );
      }
      return selectChain([{ id: 'd1', name: 'Closed Won' }]);
    });
    mockReadJsonBody.mockResolvedValue({ action: 'stage', deal_ids: ['d1'], payload: { stage_id: 'S1' } });
    const res = await bulk.POST(new Request('http://localhost/api/tenant/deals/bulk', { method: 'POST' }) as never);
    expect(res.status).toBe(200);
    const stageLookup = projections.find((p) => p.id === 'id' && 'name' in p);
    expect(
      projections,
      `no projection reads a name column: ${JSON.stringify(projections)}`,
    ).toContainEqual(expect.objectContaining({ name: 'name' }));
    expect(stageLookup, JSON.stringify(projections)).toBeTruthy();
  });
});
