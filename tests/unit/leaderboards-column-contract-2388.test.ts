/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2388 / #2389 — app/api/tenant/leaderboards must speak the schema's actual
 * language, and must not swallow the difference.
 *
 * All three deal metrics referenced `deals.owner_id`, `deals.stage`,
 * `deals.closed_at` and `deals.value`. None of those columns have ever existed
 * (the real ones are `assigned_to`, `stage_id` uuid, `close_date`/`won_at`,
 * `amount`), so every request threw Postgres 42703 — and the route's blanket
 * `catch { data = [] }` turned that into a permanent HTTP 200 with an empty
 * board. Nothing was logged, so nobody noticed.
 *
 * The interesting assertion is therefore not "is the filter right" but "do the
 * column names resolve". `checkColumnsResolve` derives the legal set from the
 * drizzle models at runtime, so the next route that invents a column fails here
 * instead of shipping a silently-empty feature. That is the same technique that
 * made #2385's tests honest: assert against the schema, not against a copy of it
 * typed into the test file.
 *
 * #2389 is pinned alongside it because it is the same four statements: deleted
 * deals/activities and `status = 'removed'` members must not count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { deals, activities, tenantMembers, users } from '@/drizzle/schema';

const h = vi.hoisted(() => ({
  executes: [] as unknown[],
  rowsFor: [] as unknown[][],
  /** When set, db.execute rejects with this — the route must not swallow it. */
  failWith: null as unknown,
}));

vi.mock('@/drizzle/db', () => {
  const db: any = {
    execute: (node: unknown) => {
      h.executes.push(node);
      if (h.failWith) return Promise.reject(h.failWith);
      // drizzle's db.execute(sql`…`) resolves to the ROW ARRAY, which is how the
      // route casts it. Mocking { rows } instead would hide a shape bug.
      return Promise.resolve(h.rowsFor.shift() ?? []);
    },
    select: () => {
      const chain: any = {
        from: () => chain,
        where: () => chain,
        then: (res: any, rej?: any) => Promise.resolve([]).then(res, rej),
      };
      for (const m of ['orderBy', 'limit', 'groupBy']) chain[m] = () => chain;
      return chain;
    },
  };
  return { db };
});

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T, >(fn: T) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: () => Promise.resolve({
    userId: '22222222-2222-4222-8222-222222222222',
    tenantId: '11111111-1111-4111-8111-111111111111',
    email: 'a@b.com',
    isSuperAdmin: false,
  }),
}));
vi.mock('@/lib/modules/gate', () => ({ requireModule: () => Promise.resolve(null) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/api-error', () => ({
  // Fail loudly: a handler that throws must not be mistaken for a pass.
  apiError: (err: unknown) => NextResponse.json({ error: `apiError: ${String(err)}` }, { status: 500 }),
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function req(metric: string) {
  return new Request(`http://localhost/api/tenant/leaderboards?metric=${metric}&period=month`, {
    method: 'GET',
  }) as unknown as NextRequest;
}

function route() {
  return import('@/app/api/tenant/leaderboards/route');
}

const dialect = new PgDialect();
function sqlOf(node: unknown): string {
  return dialect.sqlToQuery(node as never).sql;
}

/** One run of one metric, returning the single statement it issued. */
async function run(metric: string, rows: unknown[] = []): Promise<string> {
  // One statement per call, so a loop over metrics cannot accumulate and make
  // the count assertion meaningless.
  h.executes = [];
  h.rowsFor = [rows];
  const { GET } = await route();
  const res = await GET(req(metric));
  expect(res.status, `${metric}: handler returned ${res.status}, not 200`).toBe(200);
  expect(h.executes, `${metric}: expected exactly one query`).toHaveLength(1);
  return sqlOf(h.executes[0]);
}

/** `FROM users u` / `LEFT JOIN deals d` → { u: users, d: deals } */
function aliasesOf(text: string): Record<string, Record<string, unknown>> {
  const byName: Record<string, Record<string, unknown>> = {
    users, deals, activities, tenant_members: tenantMembers,
  };
  const out: Record<string, Record<string, unknown>> = {};
  const re = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\s+(?!on\b|where\b|group\b|order\b|left\b|inner\b|join\b)([a-z_][a-z0-9_]*)\b/gi;
  for (const m of text.matchAll(re)) {
    const table = byName[m[1]!.toLowerCase()];
    if (table) out[m[2]!.toLowerCase()] = table;
  }
  return out;
}

/**
 * The regression guard: every `alias.column` in the emitted SQL must be a column
 * the schema actually has. A typo'd or invented column is exactly what shipped.
 */
function checkColumnsResolve(text: string, label: string) {
  const aliases = aliasesOf(text);
  expect(Object.keys(aliases).length, `${label}: no table aliases found — parser broken`).toBeGreaterThan(0);
  const bad: string[] = [];
  for (const [alias, table] of Object.entries(aliases)) {
    const legal = new Set(Object.values(table as any).map((c: any) => c.name as string));
    for (const m of text.matchAll(new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)\\b`, 'gi'))) {
      if (!legal.has(m[1]!.toLowerCase())) bad.push(`${alias}.${m[1]}`);
    }
  }
  expect(bad, `${label}: columns not present in the drizzle model`).toEqual([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.executes = [];
  h.rowsFor = [];
  h.failWith = null;
});

// ── The column contract (#2388) ──────────────────────────────────────────────

describe('leaderboards column contract (#2388)', () => {
  it.each(['deals_won', 'revenue', 'activities', 'conversion'])(
    '%s: every qualified column resolves against the schema',
    async (metric) => {
      const text = await run(metric);
      checkColumnsResolve(text, metric);
    }
  );

  it('never names the four columns that do not exist on deals', async () => {
    for (const metric of ['deals_won', 'revenue', 'conversion']) {
      const text = await run(metric);
      for (const ghost of ['owner_id', 'closed_at', 'value']) {
        expect(text, `${metric} references phantom deals.${ghost}`).not.toMatch(/\bd\.(owner_id|closed_at|value)\b/i);
      }
      // `stage` is a uuid FK (stage_id) pointing at deal_stages, never a string.
      expect(text, `${metric} compares deals.stage as a string`).not.toMatch(/\bd\.stage\b(?!_)/i);
    }
  });

  it('wins on deals.won_at, the column the schema added for exactly that', async () => {
    for (const metric of ['deals_won', 'revenue', 'conversion']) {
      expect(await run(metric)).toMatch(/d\.won_at/i);
    }
  });

  it('attributes deals by deals.assigned_to and money by deals.amount', async () => {
    expect(await run('deals_won')).toMatch(/d\.assigned_to\s*=\s*u\.id/i);
    const revenue = await run('revenue');
    expect(revenue).toMatch(/SUM\(d\.amount\)/i);
    expect(revenue).not.toMatch(/SUM\(d\.value\)/i);
  });

  it('conversion counts won_at over a live-deal denominator', async () => {
    const text = await run('conversion');
    expect(text).toMatch(/COUNT\(CASE WHEN d\.won_at IS NOT NULL THEN 1 END\)/i);
    expect(text).toMatch(/d\.created_at/i);
  });
});

// ── Lifecycle filters (#2389) ────────────────────────────────────────────────

describe('leaderboards lifecycle filters (#2389)', () => {
  it.each([
    ['deals_won', 'd'],
    ['revenue', 'd'],
    ['conversion', 'd'],
  ])('%s excludes soft-deleted deals', async (metric, alias) => {
    expect(await run(metric)).toMatch(new RegExp(`${alias}\\.deleted_at\\s+IS\\s+NULL`, 'i'));
  });

  it('activities excludes soft-deleted activities', async () => {
    expect(await run('activities')).toMatch(/a\.deleted_at\s+IS\s+NULL/i);
  });

  it.each(['deals_won', 'revenue', 'activities', 'conversion'])(
    '%s counts only active, live members',
    async (metric) => {
      const text = await run(metric);
      expect(text).toMatch(/tm\.status\s*=\s*'active'/i);
      expect(text).toMatch(/tm\.deleted_at\s+IS\s+NULL/i);
      // The unguarded form was a bare subquery with neither predicate.
      expect(text).not.toMatch(/SELECT user_id FROM tenant_members WHERE tenant_id = \$\d+\)/i);
    }
  );

  it('keeps the LEFT JOINs so a zero-deal user still ranks at 0', async () => {
    for (const metric of ['deals_won', 'revenue', 'activities', 'conversion']) {
      expect(await run(metric), metric).toMatch(/LEFT JOIN (deals|activities)/i);
    }
  });

  it('scopes every metric to the caller tenant — twice, deals and membership', async () => {
    for (const metric of ['deals_won', 'revenue', 'activities', 'conversion']) {
      const text = await run(metric);
      const bound = text.match(/tenant_id\s*=\s*\$\d+/gi) ?? [];
      expect(bound.length, `${metric}: expected a tenant predicate on the fact table AND on tenant_members`).toBeGreaterThanOrEqual(2);
      const params = dialect.sqlToQuery(h.executes[0] as never).params;
      expect(params).toContain(TENANT_ID);
    }
  });
});

// ── The swallow (#2388) ──────────────────────────────────────────────────────

describe('leaderboards must not swallow a database error (#2388)', () => {
  it('answers 500 and logs, instead of a 200 with an empty board', async () => {
    h.failWith = Object.assign(new Error('column d.owner_id does not exist'), { code: '42703' });
    const { GET } = await route();
    const res = await GET(req('deals_won'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/owner_id/);

    const { logError } = await import('@/lib/errors-server');
    expect(logError).toHaveBeenCalledTimes(1);
    const arg = (logError as any).mock.calls[0][0];
    expect(arg.context).toMatch(/leaderboards/);
    expect(String(arg.error)).toMatch(/owner_id/);
  });

  it('does not return an empty board for a query that never ran', async () => {
    h.failWith = new Error('boom');
    const { GET } = await route();
    const res = await GET(req('revenue'));
    const body = await res.json();
    // The old bug: a failure looked exactly like a quiet month.
    expect(body).not.toMatchObject({ data: [] });
  });
});

// ── Report-shape sanity ──────────────────────────────────────────────────────

describe('leaderboards response shape', () => {
  it('ranks rows and coerces numeric values', async () => {
    const rows = [
      { userId: 'u-1', name: 'Ada', value: '3' },
      { userId: 'u-2', name: 'Bo', value: 1 },
    ];
    h.rowsFor = [rows];
    const { GET } = await route();
    const body = await (await GET(req('deals_won'))).json();
    expect(body.data).toEqual([
      { userId: 'u-1', name: 'Ada', value: 3, rank: 1 },
      { userId: 'u-2', name: 'Bo', value: 1, rank: 2 },
    ]);
    expect(body.metric).toBe('deals_won');
  });
});
