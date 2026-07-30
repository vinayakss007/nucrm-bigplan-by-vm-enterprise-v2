/**
 * Tests for deal archive visibility (#756 item 15).
 *
 * The bulk `archive` action sets metadata.archived = true, but nothing read that
 * flag: archived deals stayed in every list and `unarchive` had no visible
 * effect either. These tests pin the predicate that fixes it.
 *
 * Asserted by compiling to SQL rather than against a live database, since there
 * is no Postgres in CI for unit tests. That still catches the failure that
 * matters here — the COALESCE being dropped — because it is visible in the
 * generated SQL.
 */
import { describe, it, expect } from 'vitest';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { archiveFilter, archivedOnly, notArchived } from '@/lib/api/deals-archive-filter';
import { deals } from '@/drizzle/schema';

const dialect = new PgDialect();

/** Render a predicate to the SQL text drizzle would actually send. */
function toSql(fragment: SQL): string {
  return dialect.sqlToQuery(fragment).sql;
}

describe('notArchived', () => {
  it('excludes archived deals', () => {
    const text = toSql(notArchived());
    expect(text).toContain("archived");
    expect(text).toContain("<> 'true'");
  });

  it('COALESCEs the flag so deals predating archiving are not filtered out', () => {
    // metadata->>'archived' is NULL for every historical deal, and
    // NULL <> 'true' is NULL (not true), so without COALESCE this predicate
    // would hide the entire back catalogue.
    expect(toSql(notArchived())).toContain('COALESCE');
  });
});

describe('archivedOnly', () => {
  it('selects only archived deals', () => {
    const text = toSql(archivedOnly());
    expect(text).toContain("= 'true'");
    expect(text).toContain('COALESCE');
  });

  it('is the complement of notArchived', () => {
    expect(toSql(archivedOnly())).not.toBe(toSql(notArchived()));
  });
});

describe('archiveFilter', () => {
  it('defaults to hiding archived deals when the param is absent', () => {
    expect(toSql(archiveFilter(undefined)!)).toBe(toSql(notArchived()));
  });

  it("treats 'false' the same as absent", () => {
    expect(toSql(archiveFilter('false')!)).toBe(toSql(notArchived()));
  });

  it("returns the archived-only predicate for 'true'", () => {
    expect(toSql(archiveFilter('true')!)).toBe(toSql(archivedOnly()));
  });

  it("returns null for 'all' so the caller adds no predicate", () => {
    // null, not an always-true fragment: the route pushes nothing, which keeps
    // the generated SQL free of a redundant clause.
    expect(archiveFilter('all')).toBeNull();
  });

  it('references the deals metadata column, not contacts.isArchived', () => {
    // deals has no is_archived column; using one would be a runtime SQL error.
    expect(Object.keys(deals)).not.toContain('isArchived');
    expect(toSql(notArchived())).toContain('metadata');
  });
});
