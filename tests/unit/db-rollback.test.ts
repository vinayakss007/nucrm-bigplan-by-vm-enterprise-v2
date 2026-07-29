/**
 * Tests for lib/db/rollback.ts (issue #640)
 *
 * The database is mocked; the filesystem is NOT. The parsing and coverage tests
 * deliberately run against the real `drizzle/migrations` directory so they fail
 * if a convention changes or a rollback file disappears.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { mockQuery, mockWithMigrationLock } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWithMigrationLock: vi.fn(),
}));

vi.mock('@/lib/db/pool', () => ({
  getPool: () => ({ query: mockQuery }),
}));

vi.mock('@/lib/db/migration-safety', () => ({
  withMigrationLock: mockWithMigrationLock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  extractInlineDownSection,
  listAppliedMigrations,
  parseRollbackSql,
  readJournal,
  rollbackMigration,
  stripTransactionControl,
  verifyRollbackCoverage,
} from '@/lib/db/rollback';

const REPO_ROOT = path.resolve(import.meta.dirname!, '../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'drizzle', 'migrations');

/** Migration with a separate `.down.sql` file. */
const TAG_DOWN_FILE = '0034_add_form_views_count';
/** Migration with an inline `-- DOWN` / `-- END DOWN` section. */
const TAG_INLINE = '0036_backup_records_checksum';
// There is deliberately no TAG_NO_ROLLBACK constant pointing at a real
// migration. This file used to pin '0000_init' as "the migration with no
// rollback", and #829 (rollback scripts for 16 migrations) gave 0000_init a
// rollback, breaking five tests at once. Since #640/#829 exist precisely to
// *grow* rollback coverage, any real migration named here is a test that fails
// on progress — and once coverage reaches 100% no such migration exists at all.
// The rollback-less cases therefore run against makeScenarioDir() below.

const tempDirs: string[] = [];

function makeFixtureDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-fixture-'));
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
  tempDirs.push(dir);
  return dir;
}

/** Tags inside a scenario directory, oldest to newest. */
const SCENARIO = {
  downFile: '0000_with_down_file',
  inline: '0001_with_inline',
  noRollback: '0002_no_rollback',
} as const;

/**
 * A self-contained migrations directory holding one migration of each kind:
 * a `.down.sql` file, an inline `-- DOWN` section, and no rollback at all.
 *
 * Using a fixture keeps the rollback-less assertions independent of how much
 * rollback coverage the real repo happens to have.
 */
function makeScenarioDir(): string {
  const dir = makeFixtureDir();
  const write = (name: string, body: string) =>
    fs.writeFileSync(path.join(dir, name), body);

  write(`${SCENARIO.downFile}.sql`, 'CREATE TABLE fixture_a (id int);');
  write(`${SCENARIO.downFile}.down.sql`, 'DROP TABLE fixture_a;');
  write(
    `${SCENARIO.inline}.sql`,
    [
      'ALTER TABLE fixture_a ADD COLUMN b int;',
      '-- DOWN',
      'ALTER TABLE fixture_a DROP COLUMN b;',
      '-- END DOWN',
    ].join('\n'),
  );
  write(`${SCENARIO.noRollback}.sql`, 'CREATE TABLE fixture_c (id int);');

  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify(
      {
        version: '7',
        dialect: 'postgresql',
        entries: [
          { idx: 0, version: '7', when: 1700000000000, tag: SCENARIO.downFile, breakpoints: true },
          { idx: 1, version: '7', when: 1700000001000, tag: SCENARIO.inline, breakpoints: true },
          { idx: 2, version: '7', when: 1700000002000, tag: SCENARIO.noRollback, breakpoints: true },
        ],
      },
      null,
      2,
    ),
  );
  return dir;
}

/** A fake pg client that records every query it is given. */
function makeFakeClient() {
  const queries: string[] = [];
  return {
    queries,
    query: vi.fn((text: string) => {
      queries.push(text);
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  };
}

/** Rows as stored by the recovery path in scripts/migrate.ts (hash = tag). */
function stateRowsFromJournal(tags: string[], migrationsDir: string = MIGRATIONS_DIR) {
  const journal = readJournal(migrationsDir);
  return tags.map((tag, i) => {
    const entry = journal.find((e) => e.tag === tag);
    return { id: i + 1, hash: tag, created_at: String(entry?.when ?? 1700000000000 + i) };
  });
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: run the callback with a fake client that records queries.
  mockWithMigrationLock.mockImplementation(
    async (fn: (client: unknown) => Promise<unknown>) => fn(makeFakeClient()),
  );
});

describe('parseRollbackSql', () => {
  it('finds a separate .down.sql file', async () => {
    const sql = await parseRollbackSql(TAG_DOWN_FILE, MIGRATIONS_DIR);
    expect(sql).not.toBeNull();
    expect(sql).toContain('ALTER TABLE forms DROP COLUMN IF EXISTS views_count');
    // Sanity: this really is the down file's content, from disk.
    const onDisk = fs.readFileSync(
      path.join(MIGRATIONS_DIR, `${TAG_DOWN_FILE}.down.sql`),
      'utf-8',
    );
    expect(onDisk.trim()).toBe(sql);
  });

  it('extracts an inline -- DOWN / -- END DOWN section', async () => {
    const sql = await parseRollbackSql(TAG_INLINE, MIGRATIONS_DIR);
    expect(sql).not.toBeNull();
    expect(sql).toContain('DROP COLUMN IF EXISTS checksum');
    expect(sql).toContain('DROP COLUMN IF EXISTS checksum_algorithm');
    // The forward statements must NOT leak into the rollback SQL.
    expect(sql).not.toContain('ADD COLUMN');
    // Markers themselves are excluded.
    expect(sql).not.toContain('END DOWN');
  });

  it('prefers the .down.sql file when both conventions are present', async () => {
    const dir = makeFixtureDir();
    const tag = '9999_both_conventions';
    fs.writeFileSync(
      path.join(dir, `${tag}.sql`),
      ['CREATE TABLE t (id int);', '-- DOWN', 'SELECT 1; -- inline rollback', '-- END DOWN'].join(
        '\n',
      ),
    );
    fs.writeFileSync(path.join(dir, `${tag}.down.sql`), 'DROP TABLE t; -- down file rollback');

    const sql = await parseRollbackSql(tag, dir);
    expect(sql).toBe('DROP TABLE t; -- down file rollback');
    expect(sql).not.toContain('inline rollback');
  });

  it('returns null when no rollback exists', async () => {
    const dir = makeScenarioDir();
    expect(await parseRollbackSql(SCENARIO.noRollback, dir)).toBeNull();
    expect(await parseRollbackSql('9998_does_not_exist', MIGRATIONS_DIR)).toBeNull();
  });

  it('accepts a filename as well as a bare tag', async () => {
    const viaFilename = await parseRollbackSql(`${TAG_DOWN_FILE}.sql`, MIGRATIONS_DIR);
    const viaTag = await parseRollbackSql(TAG_DOWN_FILE, MIGRATIONS_DIR);
    expect(viaFilename).toBe(viaTag);
  });
});

describe('extractInlineDownSection', () => {
  it('ignores a "-- DOWN Migration" header and uses the bare marker', () => {
    const section = extractInlineDownSection(
      ['ALTER TABLE a ADD COLUMN b int;', '-- DOWN Migration', '-- DOWN', 'ALTER TABLE a DROP COLUMN b;', '-- END DOWN'].join('\n'),
    );
    expect(section).toBe('ALTER TABLE a DROP COLUMN b;');
  });

  it('returns null for an empty section', () => {
    expect(extractInlineDownSection('SELECT 1;\n-- DOWN\n\n-- END DOWN')).toBeNull();
  });

  it('returns null when there is no marker', () => {
    expect(extractInlineDownSection('SELECT 1;')).toBeNull();
  });
});

describe('stripTransactionControl', () => {
  it('removes top-level BEGIN/COMMIT so the caller controls the transaction', () => {
    const stripped = stripTransactionControl('BEGIN;\n\nDROP TABLE x;\n\nCOMMIT;');
    expect(stripped).toBe('DROP TABLE x;');
  });

  it('leaves BEGIN/END inside dollar-quoted PL/pgSQL bodies alone', () => {
    const sql = ['BEGIN;', 'DO $$', 'BEGIN;', 'COMMIT;', 'END $$;', 'COMMIT;'].join('\n');
    const stripped = stripTransactionControl(sql);
    expect(stripped).toBe(['DO $$', 'BEGIN;', 'COMMIT;', 'END $$;'].join('\n'));
  });
});

describe('verifyRollbackCoverage', () => {
  it('reports real counts against the actual migrations directory', () => {
    const journal = readJournal(MIGRATIONS_DIR);
    const coverage = verifyRollbackCoverage(MIGRATIONS_DIR);

    expect(coverage.total).toBe(journal.length);
    expect(coverage.entries).toHaveLength(journal.length);
    expect(coverage.covered + coverage.missing).toBe(coverage.total);
    expect(coverage.withRollback).toHaveLength(coverage.covered);
    expect(coverage.withoutRollback).toHaveLength(coverage.missing);

    // Every migration that ships rollback SQL today must be reported as covered.
    for (const tag of [
      '0034_add_form_views_count',
      '0037_tenant_isolation_hardening',
      '0038_cross_module_record_linking',
      '0036_backup_records_checksum',
      '0040_lead_product_service_request',
    ]) {
      expect(coverage.withRollback).toContain(tag);
    }

    // Note: no assertion that some specific migration is *un*covered, and none
    // that `missing > 0`. Coverage is meant to keep rising, so both would be
    // assertions against progress. The covered/uncovered split is verified
    // exactly against a fixture in the test below instead.
    expect(coverage.missing).toBeGreaterThanOrEqual(0);
    expect(coverage.coveragePercent).toBeCloseTo(
      Math.round((coverage.covered / coverage.total) * 1000) / 10,
      5,
    );
  });

  it('splits covered from uncovered migrations', () => {
    const coverage = verifyRollbackCoverage(makeScenarioDir());

    expect(coverage.total).toBe(3);
    expect(coverage.covered).toBe(2);
    expect(coverage.missing).toBe(1);
    expect([...coverage.withRollback].sort()).toEqual([SCENARIO.downFile, SCENARIO.inline]);
    expect(coverage.withoutRollback).toEqual([SCENARIO.noRollback]);
    expect(coverage.coveragePercent).toBeCloseTo(66.7, 1);
  });

  it('records the source convention for each covered migration', () => {
    const coverage = verifyRollbackCoverage(MIGRATIONS_DIR);
    const byTag = new Map(coverage.entries.map((e) => [e.tag, e]));
    expect(byTag.get('0034_add_form_views_count')?.source).toBe('down-file');
    expect(byTag.get('0036_backup_records_checksum')?.source).toBe('inline');

    // A migration with neither convention reports a null source.
    const fixture = verifyRollbackCoverage(makeScenarioDir());
    const fixtureByTag = new Map(fixture.entries.map((e) => [e.tag, e]));
    expect(fixtureByTag.get(SCENARIO.downFile)?.source).toBe('down-file');
    expect(fixtureByTag.get(SCENARIO.inline)?.source).toBe('inline');
    expect(fixtureByTag.get(SCENARIO.noRollback)?.source).toBeNull();
  });
});

describe('listAppliedMigrations', () => {
  it('returns applied migrations newest-first with rollback availability', async () => {
    const dir = makeScenarioDir();
    mockQuery.mockResolvedValue({
      rows: stateRowsFromJournal(
        [SCENARIO.downFile, SCENARIO.inline, SCENARIO.noRollback],
        dir,
      ),
    });

    const applied = await listAppliedMigrations(dir);

    // Newest first, by the journal's `when`.
    expect(applied.map((m) => m.tag)).toEqual([
      SCENARIO.noRollback,
      SCENARIO.inline,
      SCENARIO.downFile,
    ]);
    expect(applied[0]!.hasRollback).toBe(false);
    expect(applied[1]!.hasRollback).toBe(true);
    expect(applied[2]!.hasRollback).toBe(true);
    expect(applied[0]!.appliedAt).toBeInstanceOf(Date);
    expect(applied[0]!.idx).toBeGreaterThanOrEqual(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0]![0]).toContain('__drizzle_migrations');
  });

  it('returns an empty list when nothing is applied', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await listAppliedMigrations(MIGRATIONS_DIR)).toEqual([]);
  });
});

describe('rollbackMigration', () => {
  it('refuses an out-of-order rollback without force', async () => {
    mockQuery.mockResolvedValue({
      rows: stateRowsFromJournal([TAG_DOWN_FILE, TAG_INLINE]),
    });

    await expect(rollbackMigration(TAG_DOWN_FILE, { migrationsDir: MIGRATIONS_DIR })).rejects.toThrow(
      /out of order/i,
    );
    // Nothing was executed: the lock was never taken.
    expect(mockWithMigrationLock).not.toHaveBeenCalled();
  });

  it('allows an out-of-order rollback when force is passed', async () => {
    mockQuery.mockResolvedValue({
      rows: stateRowsFromJournal([TAG_DOWN_FILE, TAG_INLINE]),
    });

    const result = await rollbackMigration(TAG_DOWN_FILE, {
      migrationsDir: MIGRATIONS_DIR,
      force: true,
    });
    expect(result.committed).toBe(true);
    expect(mockWithMigrationLock).toHaveBeenCalledTimes(1);
  });

  it('commits and deletes the migration state row on a real run', async () => {
    mockQuery.mockResolvedValue({ rows: stateRowsFromJournal([TAG_DOWN_FILE, TAG_INLINE]) });

    const client = makeFakeClient();
    mockWithMigrationLock.mockImplementation(
      async (fn: (c: unknown) => Promise<unknown>) => fn(client),
    );

    const result = await rollbackMigration(TAG_INLINE, { migrationsDir: MIGRATIONS_DIR });

    expect(result).toMatchObject({ tag: TAG_INLINE, committed: true, dryRun: false, source: 'inline' });
    expect(result.stateRowDeleted).toBe(true);
    expect(client.queries).toContain('BEGIN');
    expect(client.queries).toContain('COMMIT');
    expect(client.queries).not.toContain('ROLLBACK');
    expect(client.queries.some((q) => /DELETE FROM .*__drizzle_migrations/.test(q))).toBe(true);
    expect(client.queries.some((q) => q.includes('DROP COLUMN IF EXISTS checksum'))).toBe(true);
    // The inline section's own COMMIT must not survive into the executed SQL.
    expect(result.sql).not.toMatch(/^COMMIT;$/m);
  });

  it('does not commit on dryRun', async () => {
    mockQuery.mockResolvedValue({ rows: stateRowsFromJournal([TAG_DOWN_FILE, TAG_INLINE]) });

    const client = makeFakeClient();
    mockWithMigrationLock.mockImplementation(
      async (fn: (c: unknown) => Promise<unknown>) => fn(client),
    );

    const result = await rollbackMigration(TAG_INLINE, {
      migrationsDir: MIGRATIONS_DIR,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.committed).toBe(false);
    expect(result.stateRowDeleted).toBe(false);
    expect(client.queries).toContain('BEGIN');
    expect(client.queries).toContain('ROLLBACK');
    expect(client.queries).not.toContain('COMMIT');
  });

  it('rolls the transaction back when the rollback SQL fails', async () => {
    mockQuery.mockResolvedValue({ rows: stateRowsFromJournal([TAG_DOWN_FILE, TAG_INLINE]) });

    const queries: string[] = [];
    const client = {
      query: vi.fn((text: string) => {
        queries.push(text);
        if (text.includes('DROP COLUMN')) return Promise.reject(new Error('boom'));
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
    mockWithMigrationLock.mockImplementation(
      async (fn: (c: unknown) => Promise<unknown>) => fn(client),
    );

    await expect(
      rollbackMigration(TAG_INLINE, { migrationsDir: MIGRATIONS_DIR }),
    ).rejects.toThrow('boom');
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
  });

  it('throws when the migration has no rollback SQL', async () => {
    const dir = makeScenarioDir();
    mockQuery.mockResolvedValue({ rows: stateRowsFromJournal([SCENARIO.noRollback], dir) });
    await expect(
      rollbackMigration(SCENARIO.noRollback, { migrationsDir: dir }),
    ).rejects.toThrow(/No rollback SQL found/i);
  });

  it('throws when the migration is not recorded as applied', async () => {
    mockQuery.mockResolvedValue({ rows: stateRowsFromJournal([TAG_INLINE]) });
    await expect(
      rollbackMigration(TAG_DOWN_FILE, { migrationsDir: MIGRATIONS_DIR }),
    ).rejects.toThrow(/not recorded as applied/i);
  });

  it('throws when nothing has been applied', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(
      rollbackMigration(TAG_INLINE, { migrationsDir: MIGRATIONS_DIR }),
    ).rejects.toThrow(/nothing to roll back/i);
  });
});
