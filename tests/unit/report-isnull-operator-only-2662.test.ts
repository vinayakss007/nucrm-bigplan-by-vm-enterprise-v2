/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2662 — `{ "close_date": { "op": "is_null" } }` is a filter with no value *by
 * definition*, and `filterCondition` tested for the `{ value, op }` shape with
 * `'value' in raw` alone. So the object was not recognised as an operator object,
 * fell through as the value, and:
 *
 *   - on a text column built `"contacts"."city" = $1` with the parameter bound to
 *     `{op:"is_null"}` — an object sent to Postgres as a scalar, i.e. a 500;
 *   - on a timestamp column stringified it, `new Date('[object Object]')` answered
 *     NaN, and the endpoint returned
 *     `400 Filter value '[object Object]' is not a date`.
 *
 * The `op` line right below already used `'op' in raw`. One shape, two tests, and
 * the stricter one won.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const h = vi.hoisted(() => ({ wheres: [] as unknown[] }));

vi.mock('@/drizzle/db', () => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: (w: unknown) => { h.wheres.push(w); return chain; },
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (res?: (v: unknown) => unknown, rej?: (reason: unknown) => unknown) => Promise.resolve([]).then(res, rej),
  };
  return { db: { select: () => chain } };
});

const dialect = new PgDialect();
const TENANT = '11111111-1111-4111-8111-111111111111';

function where(): { sql: string; params: unknown[] } {
  expect(h.wheres, 'the report built no WHERE clause').toHaveLength(1);
  const q = dialect.sqlToQuery(h.wheres[0] as never);
  return { sql: q.sql, params: q.params };
}

async function run(reportType: string, filters: unknown) {
  h.wheres = [];
  const mod = await import('@/app/api/tenant/reports/run/route');
  const out = await mod.runReportForTenant(TENANT, { report_type: reportType, filters });
  return { out, mod };
}

function render(mod: Record<string, unknown>, tableKey: string, field: string, raw: unknown) {
  const filterCondition = mod.filterCondition as (t: string, f: string, r: unknown) => unknown;
  return dialect.sqlToQuery(filterCondition(tableKey, field, raw) as never);
}

beforeEach(() => { vi.clearAllMocks(); h.wheres = []; });

describe('an operator object with no value is an operator object (#2662)', () => {
  it('a null test on a timestamp column is a null test, not a 400 about [object Object]', async () => {
    const { out } = await run('deals', { close_date: { op: 'is_null' } });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(where().sql).toMatch(/"?close_date"?\s+is null/i);
  });

  it('a null test on a text column binds nothing, so Postgres is not sent an object', async () => {
    const { out } = await run('contacts', { city: { op: 'is_null' } });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql, params } = where();
    expect(sql).toMatch(/"?city"?\s+is null/i);
    expect(sql).not.toMatch(/"?city"?\s*=/);
    expect(params.some(p => typeof p === 'object' && p !== null)).toBe(false);
  });

  it('a valueless contains is no filter, not an ilike on [object Object]', async () => {
    const { mod } = await run('contacts', undefined);
    const { sql, params } = render(mod, 'contacts', 'city', { op: 'contains' });
    expect(sql).toMatch(/true/);
    expect(params).toHaveLength(0);
  });

  it('the array shape reaches the same code and gets the same answer', async () => {
    // #2661 unpacks `[{ column, op, value }]`; a valueless `is_null` row must not
    // reintroduce the object-as-value path.
    const { out } = await run('deals', [{ column: 'close_date', op: 'is_null' }]);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(where().sql).toMatch(/"?close_date"?\s+is null/i);
  });
});

describe('what was a value still is a value', () => {
  it('a bare string is equality', async () => {
    const { out, mod } = await run('contacts', undefined);
    const { sql, params } = render(mod, 'contacts', 'city', 'pune');
    expect(sql).toMatch(/"?city"?\s*=/);
    expect(params).toEqual(['pune']);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
  });

  it('an object with only `value` keeps its value', async () => {
    const { mod } = await run('contacts', undefined);
    const { sql, params } = render(mod, 'deals', 'amount', { value: '100' });
    expect(sql).toMatch(/"?amount"?\s*=/);
    expect(params.map(String)).toContain('100');
  });

  it('a Date is still a Date — an object without either key is not an operator object', async () => {
    const { mod } = await run('contacts', undefined);
    const { params } = render(mod, 'deals', 'close_date', new Date('2026-01-31T00:00:00.000Z'));
    expect(String(params[0])).toMatch(/^2026-01-31T00:00:00/);
  });

  it('`is_null` with an explicit empty value is unchanged (the shape #2661 pins)', async () => {
    const { mod } = await run('contacts', undefined);
    const { sql } = render(mod, 'deals', 'close_date', { value: '', op: 'is_null' });
    expect(sql).toMatch(/"?close_date"?\s+is null/i);
  });

  it('a real `in` list still binds its members', async () => {
    const { mod } = await run('contacts', undefined);
    const { sql, params } = render(mod, 'contacts', 'city', { value: 'pune,mumbai', op: 'in' });
    expect(sql).toMatch(/in \(/i);
    expect(params).toEqual(expect.arrayContaining(['pune', 'mumbai']));
  });
});
