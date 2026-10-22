/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2661 — `/api/tenant/reports/run` is called with two filter shapes and used to
 * read only one of them.
 *
 * The record (`{ city: 'pune' }`, `{ city: { value, op } }`) is what the builder
 * posts since `toStoredFilters` exists. The array
 * (`[{ column, op, value }]`) is what the builder posted *before* it —
 * `lib/reports/report-filters.ts:13-19` says so, and says the array "still has to
 * be understood: reports saved before this existed are stored that way in
 * `platform_settings`" — and `app/tenant/reports/custom/page.tsx:56-58` says "Both
 * shapes occur". Nothing reconciled them server-side, so a pre-change saved report
 * displayed its filter rows as applied, and the query read the whole table.
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

beforeEach(() => { vi.clearAllMocks(); h.wheres = []; });

describe('the array filter shape is executed, not just displayed (#2661)', () => {
  it('a row report runs the stored array', async () => {
    const { out } = await run('contacts', [{ column: 'city', op: 'contains', value: 'pune' }]);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql, params } = where();
    expect(sql).toMatch(/"?city"?::?text ilike/i);
    expect(params).toContain('%pune%');
  });

  it('an aggregate runs it too, resolved against the aggregate base table', async () => {
    const { out } = await run('revenue', [{ column: 'amount', op: 'gt', value: '100000' }]);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql, params } = where();
    expect(sql).toMatch(/"?amount"?\s*(?:::)?\s *> /);
    expect(params.map(String)).toContain('100000');
  });

  it('reads the `field` spelling as well as `column`', async () => {
    // The declarative aggregate configs this file used to carry spelled the key
    // `field` (see the #2389 comment on `revenue`), so both names occur in data.
    const { out } = await run('deals', [{ field: 'title', value: 'Renewal' }]);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(where().params).toContain('Renewal');
  });

  it('keeps both sides of a range instead of last-write-wins', async () => {
    const { out } = await run('deals', [
      { column: 'amount', op: 'gt', value: '1000' },
      { column: 'amount', op: 'lt', value: '50000' },
    ]);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql } = where();
    expect(sql).toMatch(/"?amount"?\s*(?:::)?\s *>/);
    expect(sql).toMatch(/"?amount"?\s*(?:::)?\s *</);
  });

  it('a row with no column is skipped, not a 400 about an empty field name', async () => {
    const { out } = await run('deals', [{ op: 'contains', value: 'x' }]);
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(where().sql).not.toMatch(/ ilike /);
  });
});

describe('the record shape is unchanged (#2657 regression boundary)', () => {
  it('bare value still means equality', async () => {
    const { out } = await run('contacts', { city: 'pune' });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    const { sql, params } = where();
    expect(sql).toMatch(/"?city"?\s*=/);
    expect(sql).not.toMatch(/ilike/);
    expect(params).toContain('pune');
  });

  it('is_null is still a null test, not equality on an empty string', async () => {
    // `fromStoredFilters` maps an operator outside REPORT_FILTER_OPS to `equals`,
    // so this endpoint could not simply reuse it: `is_null` would have become
    // `close_date = ''` — a filter that had to keep meaning what it says.
    // The value key is present-and-empty because a bare `{ op: 'is_null' }` is a
    // separate defect, pinned by #2662: `filterCondition` only recognises the
    // `{ value, op }` shape when `value` is a key, and otherwise binds the object.
    const { out } = await run('deals', { close_date: { value: '', op: 'is_null' } });
    expect(out, JSON.stringify(out)).not.toHaveProperty('error');
    expect(where().sql).toMatch(/"?close_date"?\s+is null/i);
  });

  it('an unknown field in the array shape is a 400 like the record shape', async () => {
    const { out } = await run('deals', [{ column: 'not_a_column', value: 'x' }]);
    expect(out).toMatchObject({ status: 400, error: /Unknown field 'not_a_column'/ });
  });
});

describe('filterPairs reads shapes without inventing filters', () => {
  it('absent, empty and non-object input produce no predicates', async () => {
    const { mod } = await run('deals', undefined);
    for (const bad of [undefined, null, '', 'pune', 42, {}, [], true]) {
      expect(mod.filterPairs(bad)).toEqual([]);
      expect(mod.filterConditions('deals', bad)).toEqual([]);
    }
  });

  it('an array row keeps its operator and value as one pair', async () => {
    const { mod } = await run('deals', undefined);
    expect(mod.filterPairs([{ column: 'amount', op: 'lt', value: '500' }]))
      .toEqual([['amount', { value: '500', op: 'lt' }]]);
  });

  it('a record row is passed through untouched, op and all', async () => {
    const { mod } = await run('deals', undefined);
    expect(mod.filterPairs({ amount: { value: '500', op: 'is_null' }, city: 'pune' }))
      .toEqual([['amount', { value: '500', op: 'is_null' }], ['city', 'pune']]);
  });
});
