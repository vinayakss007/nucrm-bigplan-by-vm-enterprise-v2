/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2766 — five endpoints clamped a query number with `Math.min`/`Math.max` around a
 * `parseInt`/`Number`, and neither `Math` function clamps `NaN`: it propagates. What the
 * propagating value then does depends on where it lands, and every outcome is worse than
 * the 400 the input deserved:
 *
 *   - `pg-core/dialect.js:286` (quoted, because it is the whole mechanism):
 *       const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0
 *                          ? sql` limit ${limit}` : void 0;
 *       const offsetSql = offset ? sql` offset ${offset}` : void 0;
 *     `NaN >= 0` is false and `NaN` is not an object, so `.limit(NaN)` does not error — it
 *     silently **removes the cap**. #2664 measured exactly this on `reports/run` and wrote
 *     it up at `app/api/tenant/reports/run/route.ts:82-88`.
 *   - `app/api/tenant/csat/stats/route.ts` pushed `NaN` into `setDate(…)` and handed
 *     Postgres an Invalid Date: a 500 plus a CRITICAL_ERROR alert for a URL typo.
 *   - `app/api/system/cron-health/route.ts` handed `NaN` to
 *     `lib/cron/health.ts:81`'s `now - lastRunAt > maxAgeMs`; every comparison with `NaN`
 *     is false, so the endpoint answered `{"status":"healthy"}` for a fleet whose cron had
 *     not run for a week.
 *   - `app/api/scim/v2/Users/route.ts` echoed `startIndex: NaN`, which `JSON.stringify`
 *     writes as `null` — malformed SCIM, answered 200.
 *
 * The contract these tests assert is therefore two-sided, and both sides are checked:
 * the value each route hands drizzle satisfies the predicate drizzle itself applies (a
 * whole number ≥ 0, so the clause survives), and where the value is observable in a
 * response or in a monitor's verdict, that outcome is asserted too.
 *
 * Measured red against `main`: the five route files restored from HEAD, the shared
 * `clampInt` left in place so this file still imports — **11 failed / 18 passed**. The
 * eleven are the junk-value cases (`?days=abc`, `?limit=abc` on both routes that take a
 * limit, `?count=abc`, `?startIndex=abc` — the one `JSON.stringify` wrote as `null` — and
 * `?maxAgeMs=abc`), the three empty-parameter cases that `Number('')` turned into `0`, and
 * the two negatives that reached drizzle as `-1`. Every cap, floor and
 * default-preservation control passed on main too, as it must: this fix narrows behaviour,
 * it does not widen it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const TENANT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const { mockRequireAuth, mockRateLimitMutating, mockVerifySCIMToken, state } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRateLimitMutating: vi.fn(),
  mockVerifySCIMToken: vi.fn(),
  state: {
    rows: [] as unknown[][],
    limits: [] as unknown[],
    offsets: [] as unknown[],
    wheres: [] as unknown[],
  },
}));

/**
 * Awaitable drizzle-chain stub that records the arguments the route passed to
 * `limit`/`offset`/`where`, so the tests can ask what drizzle would have rendered.
 * `rows` is consumed per awaited query, in call order.
 */
function makeChain() {
  const chain: Record<string, unknown> = {};
  const pass = () => chain;
  for (const m of ['from', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy', 'having', 'on']) {
    chain[m] = pass;
  }
  chain.where = (arg: unknown) => {
    state.wheres.push(arg);
    return chain;
  };
  chain.limit = (n: unknown) => {
    state.limits.push(n);
    return chain;
  };
  chain.offset = (n: unknown) => {
    state.offsets.push(n);
    return chain;
  };
  chain.then = (resolve: (v: unknown) => void) => resolve(state.rows.shift() ?? []);
  return chain;
}

vi.mock('@/drizzle/db', () => ({ db: { select: () => makeChain() } }));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: mockRequireAuth }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: mockRateLimitMutating }));
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((_err: unknown, msg: string, status: number) =>
    NextResponse.json({ error: msg }, { status })),
}));
// The real `generateSCIMResponse` is the point of the SCIM cases: it is the function that
// puts `startIndex` into the body, so only the token check may be faked.
vi.mock('@/lib/scim', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  verifySCIMToken: mockVerifySCIMToken,
}));

import { clampInt } from '@/lib/api/query-params';
import { registerCronRun, resetCronHealth } from '@/lib/cron/health';
import { GET as csatStats } from '@/app/api/tenant/csat/stats/route';
import { GET as auditExport } from '@/app/api/tenant/audit/export/route';
import { GET as scimUsers } from '@/app/api/scim/v2/Users/route';
import { GET as superadminSearch } from '@/app/api/superadmin/search/route';
import { GET as cronHealth } from '@/app/api/system/cron-health/route';

const dialect = new PgDialect({} as never);

/**
 * `dialect.js:286`'s own condition, copied out of the dependency this repo ships. A limit
 * that fails it is a limit drizzle renders as no LIMIT clause at all — which is why
 * "the cap is 50 000" and "there is no cap" can both be true of the same line of code.
 */
const keepsLimitClause = (n: unknown): boolean =>
  typeof n === 'object' || (typeof n === 'number' && n >= 0);

/** The bound values a captured `where()` predicate will hand the driver. */
function whereParams(where: unknown): unknown[] {
  return dialect.sqlToQuery(where as SQL).params;
}

function resetState(rows: unknown[][] = []) {
  state.rows = rows;
  state.limits = [];
  state.offsets = [];
  state.wheres = [];
}

describe('clampInt — the shared NaN-proof clamp (#2766)', () => {
  it('keeps the documented default for an absent parameter', () => {
    expect(clampInt(null, 30, 1, 365)).toBe(30);
  });

  it('treats an empty parameter as the absent one it means, not as 0', () => {
    // `?days=` and `?days` both answer `''`, and `'' ?? fallback` is `''` — the nullish
    // coalesce only covers an absent key. `Number('')` is `0`, which satisfies drizzle's
    // `0 >= 0` and emits `LIMIT 0`: a successful, empty, wrong answer.
    expect(clampInt('', 30, 1, 365)).toBe(30);
    expect(clampInt('   ', 30, 1, 365)).toBe(30);
  });

  it('falls back on text that is not a number, however it is spelled', () => {
    for (const raw of ['abc', '30x', 'NaN', '12 34', '-']) {
      expect(clampInt(raw, 30, 1, 365)).toBe(30);
    }
  });

  it('parses with Number, so an exponent is the value asked for rather than its prefix', () => {
    // parseInt('1e3', 10) is 1 and parseInt('30x') is 30: both guess. #2664's ruling on
    // guessing is #2664's own: `reports/run` rejects instead.
    expect(clampInt('1e3', 10, 1, 25)).toBe(25); // 1000, capped
    expect(clampInt('1e2', 10, 1, 200)).toBe(100);
  });

  it('truncates a fractional count instead of binding a fractional LIMIT', () => {
    expect(clampInt('25.7', 10, 1, 100)).toBe(25);
  });

  it('clamps both ends, including the negative that reaches drizzle as a dropped clause', () => {
    expect(clampInt('-1', 10, 1, 100)).toBe(1);
    expect(clampInt('0', 10, 1, 100)).toBe(1);
    expect(clampInt('999999', 10, 1, 100)).toBe(100);
  });

  it('always produces a value drizzle will render a clause for', () => {
    for (const raw of [null, '', ' ', 'abc', '-1', '0', '1e3', '25.7', '50', '99999999']) {
      expect(keepsLimitClause(clampInt(raw, 10, 1, 100))).toBe(true);
    }
  });
});

describe('GET /api/tenant/csat/stats — ?days', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, userId: 'u1' } as never);
    resetState([[{ total: 4, responded: 2, avgScore: '4.50' }], [], []]);
  });

  /** The `since` bound the route will send for its `createdAt >= since` predicate. */
  function sinceBound(): Date {
    const dates = whereParams(state.wheres[0]).filter(
      (p): p is Date => p instanceof Date,
    );
    expect(dates).toHaveLength(1);
    return dates[0]!;
  }

  it('answers a junk ?days with the documented 30-day window, not an Invalid Date', async () => {
    const res = await csatStats(new NextRequest('http://x/api/tenant/csat/stats?days=abc'));
    expect(res.status).toBe(200);
    const since = sinceBound();
    // Pre-fix this was `new Date(NaN)`: `Number.isNaN(getTime())` true, and the driver
    // has no timestamp to build from it.
    expect(Number.isNaN(since.getTime())).toBe(false);
    const daysBack = (Date.now() - since.getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThanOrEqual(29.5);
    expect(daysBack).toBeLessThanOrEqual(30.5);
  });

  it('treats an empty ?days= as the absent parameter it is', async () => {
    await csatStats(new NextRequest('http://x/api/tenant/csat/stats?days='));
    const daysBack = (Date.now() - sinceBound().getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThanOrEqual(29.5);
  });

  it('keeps the existing floor for a negative ?days', async () => {
    // Non-regression control: `Math.max(1, -5)` was already 1, so this window is what
    // the route has always produced.
    await csatStats(new NextRequest('http://x/api/tenant/csat/stats?days=-5'));
    const daysBack = (Date.now() - sinceBound().getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThanOrEqual(0.9);
    expect(daysBack).toBeLessThanOrEqual(1.2);
  });

  it('keeps the existing 365-day cap', async () => {
    await csatStats(new NextRequest('http://x/api/tenant/csat/stats?days=9999'));
    const daysBack = (Date.now() - sinceBound().getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThanOrEqual(364);
    expect(daysBack).toBeLessThanOrEqual(365.2);
  });

  it('still filters on the tenant', async () => {
    await csatStats(new NextRequest('http://x/api/tenant/csat/stats?days=7'));
    expect(whereParams(state.wheres[0])).toContain(TENANT_ID);
  });
});

describe('GET /api/tenant/audit/export — ?limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ tenantId: TENANT_ID, isAdmin: true } as never);
    mockRateLimitMutating.mockResolvedValue(null);
  });

  async function getLimit(query: string): Promise<unknown> {
    resetState([[{ id: 'e1', action: 'update', entityType: 'deal', entityId: 'd1', userId: 'u1', userEmail: 'a@b.c', userName: 'A', metadata: {}, ipAddress: '1.2.3.4', createdAt: new Date() }]]);
    const res = await auditExport(
      new NextRequest(`http://x/api/tenant/audit/export?format=json${query}`),
    );
    expect(res.status).toBe(200);
    expect(state.limits).toHaveLength(1);
    return state.limits[0];
  }

  it('caps the export at its documented 50 000 instead of removing the cap', async () => {
    // `Math.min(50000, Number('abc'))` is `NaN`, and a `NaN` limit is no limit: the whole
    // tenant audit trail would have been read into one response.
    expect(await getLimit('&limit=abc')).toBe(5000);
    expect(keepsLimitClause(await getLimit('&limit=abc'))).toBe(true);
  });

  it('refuses a negative limit, which dropped the clause just as silently', async () => {
    // `Math.min(50000, -1)` is `-1`, and `-1 >= 0` is false.
    const limit = await getLimit('&limit=-1');
    expect(limit).toBe(1);
    expect(keepsLimitClause(limit)).toBe(true);
  });

  it('keeps the 50 000 ceiling and the 5 000 default', async () => {
    expect(await getLimit('&limit=999999')).toBe(50000);
    expect(await getLimit('')).toBe(5000);
    expect(await getLimit('&limit=')).toBe(5000);
  });

  it('serves the rows the query returned', async () => {
    resetState([[{ id: 'e1', action: 'update', entityType: 'deal', entityId: 'd1', userId: 'u1', userEmail: 'a@b.c', userName: 'A', metadata: {}, ipAddress: '1.2.3.4', createdAt: new Date().toISOString() }]]);
    const res = await auditExport(new NextRequest('http://x/api/tenant/audit/export'));
    const body = JSON.parse(await res.text()) as { data: unknown[]; meta: { total: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });
});

describe('GET /api/scim/v2/Users — ?count and ?startIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySCIMToken.mockResolvedValue({ tenantId: TENANT_ID });
  });

  function request(query: string): NextRequest {
    return new NextRequest(`http://x/api/scim/v2/Users?${query}`, {
      headers: { authorization: 'Bearer scim-token', 'x-tenant-id': TENANT_ID },
    });
  }

  async function list(query: string): Promise<{ body: Record<string, unknown> }> {
    // first awaited select = the count, second = the page itself
    resetState([[{ count: '3' }], [{ id: 'u1', email: 'a@b.c', fullName: 'A B', createdAt: new Date(), updatedAt: new Date() }]]);
    const res = await scimUsers(request(query));
    expect(res.status).toBe(200);
    return { body: JSON.parse(await res.text()) as Record<string, unknown> };
  }

  it('holds its documented page size when ?count is not a number', async () => {
    await list('count=abc');
    expect(state.limits).toEqual([100]);
    expect(keepsLimitClause(state.limits[0])).toBe(true);
  });

  it('never renders a startIndex that JSON cannot carry', async () => {
    // Pre-fix `?startIndex=abc` produced `NaN`, and `JSON.stringify` writes that as
    // `null` — a SCIM list response with a `null` `startIndex` is not a SCIM response.
    const { body } = await list('startIndex=abc');
    expect(body.startIndex).toBe(1);
    expect(typeof body.startIndex).toBe('number');
    expect(state.offsets).toEqual([0]);
  });

  it('treats an empty ?startIndex= as the absent parameter', async () => {
    const { body } = await list('startIndex=');
    expect(body.startIndex).toBe(1);
  });

  it('keeps the 100-row ceiling and the 1-row floor', async () => {
    await list('count=500');
    expect(state.limits).toEqual([100]);
    await list('count=-1');
    expect(state.limits).toEqual([1]);
  });

  it('honours a well-formed page request', async () => {
    const { body } = await list('startIndex=21&count=10');
    expect(state.limits).toEqual([10]);
    expect(state.offsets).toEqual([20]);
    expect(body.startIndex).toBe(21);
    expect(body.totalResults).toBe(3);
  });
});

describe('GET /api/superadmin/search — ?limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ isSuperAdmin: true } as never);
  });

  async function limits(query: string): Promise<unknown[]> {
    resetState([[], []]);
    const res = await superadminSearch(
      new NextRequest(`http://x/api/superadmin/search?q=acme${query}`),
    );
    expect(res.status).toBe(200);
    return state.limits;
  }

  it('caps both selects instead of dropping both clauses', async () => {
    // The route runs tenants and users in one `Promise.all`, so `NaN` removed the cap
    // twice over.
    expect(await limits('&limit=abc')).toEqual([10, 10]);
  });

  it('refuses a negative, which reached drizzle as `-1` and dropped the clause', async () => {
    const got = await limits('&limit=-1');
    expect(got).toEqual([1, 1]);
    expect(keepsLimitClause(got[0])).toBe(true);
  });

  it('answers an empty ?limit= with the default page, not with `LIMIT 0`', async () => {
    // `Number('')` is `0`, `0 >= 0` is true, so the clause stayed and the search came
    // back empty for a caller who asked for the default.
    expect(await limits('&limit=')).toEqual([10, 10]);
  });

  it('keeps the 10 default and the 25 ceiling the existing tests pin', async () => {
    expect(await limits('')).toEqual([10, 10]);
    expect(await limits('&limit=100')).toEqual([25, 25]);
  });
});

describe('GET /api/system/cron-health — ?maxAgeMs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A job that reported in 20 minutes ago, which is stale against the route's own 15-minute
   * default and against every floor it has ever applied.
   *
   * The fake clock stays under the request: the route calls `Date.now()` itself, so
   * restoring real time before the call would compare a 2026-10-17T10:20Z `lastRunAt`
   * against the host's clock and every job would read as not-yet-run.
   */
  async function withStaleFleet(query: string): Promise<Record<string, unknown>> {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T10:00:00Z'));
    resetCronHealth();
    registerCronRun(`job-${query.replace(/\W/g, '') || 'absent'}`, { durationMs: 10, status: 'ok' });
    vi.setSystemTime(new Date('2026-10-17T10:20:00Z'));

    mockRequireAuth.mockResolvedValue({ isSuperAdmin: true, tenantId: TENANT_ID } as never);
    resetState();
    const res = await cronHealth(
      new NextRequest(`http://x/api/system/cron-health${query}`),
    );
    expect(res.status).toBe(200);
    return JSON.parse(await res.text()) as Record<string, unknown>;
  }

  it('still reports a dead fleet as dead when ?maxAgeMs is not a number', async () => {
    // The bug this file exists for: `Math.max(Number('abc'), 60_000)` is `NaN`, and
    // `lib/cron/health.ts:81` compares `now - lastRunAt > NaN`, which is false for every
    // job. The monitor did not fail — it reported that it was watching.
    const body = await withStaleFleet('?maxAgeMs=abc');
    expect(body.status).toBe('degraded');
    expect(Number(body.staleCount)).toBeGreaterThanOrEqual(1);
  });

  it('reports the same fleet stale with no parameter at all', async () => {
    const body = await withStaleFleet('');
    expect(body.status).toBe('degraded');
  });

  it('keeps the 60-second floor and an open ceiling', async () => {
    const tight = await withStaleFleet('?maxAgeMs=1000');
    expect(Number(tight.staleCount)).toBeGreaterThanOrEqual(1);
    const wide = await withStaleFleet('?maxAgeMs=86400000');
    expect(wide.status).toBe('healthy');
  });

  it('treats an empty ?maxAgeMs= as the absent parameter', async () => {
    const body = await withStaleFleet('?maxAgeMs=');
    expect(body.status).toBe('degraded');
  });
});
