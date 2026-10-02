/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import {
  fromStoredFilters,
  isTimestampColumnValue,
  toStoredFilters,
} from '@/lib/reports/report-filters';
import { filterCondition } from '@/app/api/tenant/reports/run/route';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { vi } from 'vitest';

vi.mock('@/drizzle/db', () => ({ db: {} }));

/**
 * The builder page keeps filters as UI rows and posts them to two endpoints that
 * read a record. Until the two were reconciled the page saved the array form, so
 * a reloaded report lost its operator and a "contains" filter searched for the
 * literal text of the stored object.
 */
describe('custom report filter round-trip', () => {
  it('writes one record entry per column with its operator', () => {
    expect(toStoredFilters([
      { column: 'last_name', op: 'contains', value: 'obrien' },
      { column: 'lead_status', op: 'in', value: 'new, won' },
    ])).toEqual({
      last_name: { value: 'obrien', op: 'contains' },
      lead_status: { value: 'new, won', op: 'in' },
    });
  });

  it('drops a row whose value box is empty', () => {
    expect(toStoredFilters([{ column: 'email', op: 'equals', value: '' }])).toEqual({});
  });

  it('reads back the record it wrote, operator intact', () => {
    const rows = [
      { column: 'last_name', op: 'contains', value: 'obrien' },
      { column: 'amount', op: 'gt', value: '1000' },
    ];
    expect(fromStoredFilters(toStoredFilters(rows))).toEqual(rows);
  });

  it('reads the bare-string form as equals', () => {
    expect(fromStoredFilters({ lead_status: 'won' }))
      .toEqual([{ column: 'lead_status', op: 'equals', value: 'won' }]);
  });

  it('reads the legacy array shape rather than indexing it', () => {
    // Object.entries() on this would have produced columns named "0" and "1".
    expect(fromStoredFilters([
      { column: 'city', op: 'contains', value: 'pune' },
      { column: 'country', op: 'equals', value: 'IN' },
    ])).toEqual([
      { column: 'city', op: 'contains', value: 'pune' },
      { column: 'country', op: 'equals', value: 'IN' },
    ]);
  });

  it('tolerates absent, empty and malformed stored filters', () => {
    expect(fromStoredFilters(undefined)).toEqual([]);
    expect(fromStoredFilters(null)).toEqual([]);
    expect(fromStoredFilters({})).toEqual([]);
    expect(fromStoredFilters([{ op: 'contains', value: 'x' }])).toEqual([]);
    expect(fromStoredFilters({ amount: { op: 'nope' } }))
      .toEqual([{ column: 'amount', op: 'equals', value: '' }]);
  });
});

describe('report results cell formatting', () => {
  it('treats a serialized timestamp as a date', () => {
    expect(isTimestampColumnValue('2026-09-29T09:52:19.079Z')).toBe(true);
  });

  it('does not treat ordinary text containing a capital T as a date', () => {
    // formatDate() answers '—' for anything it cannot parse, so matching these
    // blanked out the value the customer was trying to read.
    for (const text of ['Thomas', 'Task: follow up the TATA deal', 'T- shirt order', 'Tata Group']) {
      expect(isTimestampColumnValue(text)).toBe(false);
    }
  });

  it('ignores non-strings', () => {
    expect(isTimestampColumnValue(42)).toBe(false);
    expect(isTimestampColumnValue(null)).toBe(false);
  });
});

const renderPredicate = (predicate: SQL): string => new PgDialect().sqlToQuery(predicate).sql;

describe('the stored record is what the run endpoint reads', () => {
  it('keeps "contains" an ILIKE instead of degrading it to equality', () => {
    const stored = toStoredFilters([{ column: 'last_name', op: 'contains', value: 'obrien' }]);
    const [column, raw] = Object.entries(stored)[0] ?? [];
    expect(column).toBe('last_name');
    const predicate = renderPredicate(filterCondition('contacts', column, raw));
    expect(predicate).toContain('ilike');
    expect(predicate).not.toContain('="');
  });

  it('keeps a bare stored value meaning equality', () => {
    const predicate = renderPredicate(filterCondition('contacts', 'lead_status', 'won'));
    expect(predicate).toContain('=');
    expect(predicate).not.toContain('ilike');
  });

  it('keeps "gt" a comparison', () => {
    const stored = toStoredFilters([{ column: 'amount', op: 'gt', value: '1000' }]);
    const [column, raw] = Object.entries(stored)[0] ?? [];
    expect(renderPredicate(filterCondition('deals', column, raw))).toContain('>');
  });

  // A filter value is a string on the wire, but drizzle maps a timestamp
  // column's value with toISOString(), so binding one threw a TypeError and the
  // run endpoint answered 500 for every date filter a saved report stored.
  it('binds a date filter as a timestamp, not the raw string', () => {
    // drizzle maps the Date through toDriverValue, which is the call that used
    // to throw on a string; what reaches Postgres has to be a full timestamp.
    const { params } = new PgDialect().sqlToQuery(
      filterCondition('deals', 'close_date', { value: '2026-01-31', op: 'gt' })
    );
    expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(String(params[0]).startsWith('2026-01-31')).toBe(true);
  });

  it('refuses a value that is not a date instead of 500ing', () => {
    expect(() => filterCondition('deals', 'close_date', 'last tuesday'))
      .toThrow(/not a date/);
  });

  it('leaves a text column bound as text', () => {
    const { params } = new PgDialect().sqlToQuery(filterCondition('contacts', 'lead_status', 'won'));
    expect(params).toContain('won');
  });
});
