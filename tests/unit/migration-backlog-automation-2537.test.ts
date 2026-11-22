/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2537 — regression guards for the backlog simulation/apply automation.
 *
 * The simulation found two migrations that no static check caught: 0118 read
 * pg_index.indisconstraint and 0146 read pg_policy.polusing — neither column
 * exists on PostgreSQL 16, so the apply aborted midway. This file pins the
 * corrected catalog accessors and the pure helpers the owner script uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatRunbookRecord, parsePendingCount } from '../../scripts/apply-migration-backlog.mts';
import { readJournalEntries } from '../../scripts/simulate-migration-backlog.mts';

const ROOT = join(import.meta.dirname!, '../..');
const migration = (name: string): string =>
  readFileSync(join(ROOT, 'drizzle', 'migrations', name), 'utf-8');

describe('parsePendingCount (#2537)', () => {
  it('reads the Pending line from a db:status transcript', () => {
    const out = '=== Summary ===\n  Applied:   126\n  Pending:   27\n  Total:     153 journal entr(ies)\n';
    expect(parsePendingCount(out)).toBe(27);
  });

  it('returns null when the tool failed before printing a summary', () => {
    expect(parsePendingCount('ERROR: set PROBE_DATABASE_URL or DATABASE_URL')).toBeNull();
  });
});

describe('formatRunbookRecord (#2537)', () => {
  it('records the date, the before count and the tags actually applied', () => {
    const line = formatRunbookRecord('2026-11-21T10:30:00.000Z', 27, ['0146_rls_tombstone_arm']);
    expect(line).toContain('2026-11-21');
    expect(line).toContain('27 pending → 0');
    expect(line).toContain('0146_rls_tombstone_arm');
    expect(line).toContain('db:status');
  });
});

describe('journal', () => {
  it('reads the real journal with every pending tag in apply order', () => {
    const entries = readJournalEntries();
    expect(entries.length).toBeGreaterThan(126);
    expect(entries[0].tag).toBe('0000_init');
    expect(entries[entries.length - 1].tag).toMatch(/^0150_/);
  });
});

describe('pending migrations apply on PostgreSQL 16 (#2537 simulation)', () => {
  it('0118 finds constraint-backed indexes through pg_constraint.conindid', () => {
    const sql = migration('0118_fk_column_indexes.sql');
    expect(sql).not.toContain('indisconstraint');
    expect(sql).toContain('con.conindid = c.oid');
  });

  it('0146 reads policy expressions with pg_get_expr, not nonexistent polusing', () => {
    const sql = migration('0146_rls_tombstone_arm.sql');
    expect(sql).not.toContain('polusing');
    expect(sql).not.toContain('app/include_deleted');
    expect(sql).toContain('pg_get_expr(p.polqual, p.polrelid)');
    expect(sql).toContain('pg_get_expr(p.polwithcheck, p.polrelid)');
  });

  it('0146 never attaches WITH CHECK to a SELECT or DELETE policy', () => {
    const sql = migration('0146_rls_tombstone_arm.sql');
    expect(sql).not.toMatch(/FOR\s+(SELECT|DELETE)\s+USING\s+\([^)]*\)\s+WITH\s+CHECK/i);
    expect(sql).toContain('FOR INSERT WITH CHECK');
  });
});
