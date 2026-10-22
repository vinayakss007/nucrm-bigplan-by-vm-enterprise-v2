/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2664 — `limit` decided how many rows the report read, and for some values it
 * decided nothing.
 *
 * The row branch built `.limit(Math.min(Number(limit) || 100, 1000))`. Only `0`,
 * `''` and `NaN` are falsy, so `-1` sailed through the `||` and drizzle — measured
 * against a real `PgDatabase`, no DB required — then **dropped the LIMIT clause
 * from the SQL**: `select "id" from "deals"`, no limit, whole tenant, answered 200.
 * `0` silently meant 100, and `1.5` was bound as given. The caller could not tell
 * any of these apart from a normal response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ limits: [] as unknown[] }));

vi.mock('@/drizzle/db', () => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: (n: unknown) => { h.limits.push(n); return chain; },
    then: (res?: (v: unknown) => unknown, rej?: (reason: unknown) => unknown) => Promise.resolve([]).then(res, rej),
  };
  return { db: { select: () => chain } };
});

const TENANT = '11111111-1111-4111-8111-111111111111';

async function run(reportType: string, limit: unknown) {
  h.limits = [];
  const mod = await import('@/app/api/tenant/reports/run/route');
  const out = await mod.runReportForTenant(TENANT, { report_type: reportType, limit });
  return { out, mod, limitArg: h.limits[0] };
}

beforeEach(() => { vi.clearAllMocks(); h.limits = []; });

describe('an unusable limit is refused, not silently unbounded (#2664)', () => {
  it.each([
    ['-1', -1],
    ['-0.5', -0.5],
    ['0 (which used to mean 100)', 0],
    ['1.5', 1.5],
    ['a non-numeric string', 'pune'],
    ['true (Number(true) is 1)', true],
    ['an object', { n: 10 }],
    ['an array', [10]],
  ])('%s is a 400', async (_label, limit) => {
    const { out } = await run('deals', limit);
    expect(out).toMatchObject({ status: 400, error: /positive whole number/i });
  });

  it('the query is never built, so no SQL without a LIMIT clause can escape', async () => {
    const { out } = await run('deals', -1);
    expect('error' in out).toBe(true);
    expect(h.limits, 'the negative limit reached drizzle, which drops the clause').toHaveLength(0);
  });
});

describe('a usable limit means what the caller wrote', () => {
  it.each([
    ['absent', undefined, 100],
    ['null', null, 100],
    ['empty string', '', 100],
  ])('%s is the documented default', async (_label, limit, expected) => {
    const { out, limitArg } = await run('deals', limit);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(limitArg).toBe(expected);
  });

  it('500 and "500" are both honoured exactly', async () => {
    for (const limit of [500, '500']) {
      const { out, limitArg } = await run('deals', limit);
      expect(out, JSON.stringify(out)).not.toHaveProperty('error');
      expect(limitArg).toBe(500);
    }
  });

  it('the 1000-row server cap still applies', async () => {
    const { out, limitArg } = await run('deals', 1e9);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(limitArg).toBe(1000);
  });
});

describe('resolveLimit is total', () => {
  it('never returns a non-positive or fractional count, and never throws a TypeError', async () => {
    const { mod } = await run('deals', undefined);
    for (const limit of [-1e9, -1, -0.5, 0, 0.5, 1, 1.5, 1000, 1000.5, 1e9, Infinity]) {
      const resolved = (() => {
        try { return mod.resolveLimit(limit); } catch { return 'threw'; }
      })();
      if (resolved === 'threw') continue;
      expect(Number.isInteger(resolved), `limit ${limit} resolved to ${resolved}`).toBe(true);
      expect(resolved).toBeGreaterThan(0);
      expect(resolved).toBeLessThanOrEqual(1000);
    }
    expect(mod.resolveLimit(undefined)).toBe(mod.REPORT_LIMIT_DEFAULT);
    expect(mod.REPORT_LIMIT_DEFAULT).toBe(100);
    expect(mod.REPORT_LIMIT_MAX).toBe(1000);
  });
});

describe('aggregates refuse an unusable limit too', () => {
  it('a grouped report reads a handful of rows, so the cap is not applied — but the request is still validated', async () => {
    const bad = await run('pipeline', -1);
    expect(bad.out).toMatchObject({ status: 400, error: /positive whole number/i });

    const good = await run('pipeline', 500);
    expect(good.out, JSON.stringify(good.out)).not.toHaveProperty('error');
    expect(h.limits, 'an aggregate should not gain a row cap here').toHaveLength(0);
  });
});
