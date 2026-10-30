/**
 * #3301 — which pending migration files CANNOT be applied by the incremental
 * drizzle-orm migrator, and therefore must be routed through this repo's own
 * online engine (`applyMigrationFile`, which executes CONCURRENTLY DDL outside
 * a transaction).
 *
 * The reason this function exists is measured, not assumed: `migrate()` from
 * `drizzle-orm/node-postgres/migrator` hands the whole pending set to
 * `pg-core/dialect.migrate()`, which opens ONE `session.transaction()` around
 * every pending file. `CREATE INDEX CONCURRENTLY` refuses to run inside a
 * transaction block, so a migration that uses it aborts the entire incremental
 * run with SQLSTATE 25001 — and 0118's header comment used exactly that fact to
 * justify building 100 indexes in a way that locks out writes. The fix is to
 * route those files to the engine that can run them, not to keep shipping
 * blocking DDL.
 *
 * No database is needed or touched here: the classification is pure text →
 * statement list, using the same two helpers the runner itself uses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chooseApplyRoute,
  extractStatements,
  filesNeedingOnlineApply,
  partitionStatements,
} from '../../scripts/migrate-fresh';

const ROOT = join(import.meta.dirname!, '..', '..');
const UP = readFileSync(join(ROOT, 'drizzle/migrations/0118_fk_column_indexes.sql'), 'utf8');

/** The single non-transactional chunk type the online engine has to unwrap. */
const concurrentChunks = (sql: string) =>
  partitionStatements(extractStatements(sql)).filter((c) => c.type === 'nontransactional');

describe('filesNeedingOnlineApply (#3301)', () => {
  it('flags a file whose CREATE INDEX carries CONCURRENTLY', () => {
    const sql = `CREATE INDEX CONCURRENTLY "a_idx" ON "public"."a" ("b");`;
    expect(filesNeedingOnlineApply([{ tag: '0001_x', content: sql }])).toEqual(['0001_x']);
  });

  it('does not flag a file of plain (blocking) index builds', () => {
    const sql = `CREATE INDEX IF NOT EXISTS "a_idx" ON "public"."a" ("b");`;
    expect(filesNeedingOnlineApply([{ tag: '0001_x', content: sql }])).toEqual([]);
  });

  it('does not flag a file that only MENTIONS CONCURRENTLY in a comment', () => {
    // This is the shape of 0118's §3 header: prose about why the keyword is NOT
    // used. A naive text scan over the file would classify it as online-only and
    // route every apply through the other engine.
    const sql = `-- Why plain CREATE INDEX (not CONCURRENTLY): it aborts in a tx.\nCREATE INDEX IF NOT EXISTS "a_idx" ON "public"."a" ("b");`;
    expect(filesNeedingOnlineApply([{ tag: '0002_y', content: sql }])).toEqual([]);
  });

  it('flags CREATE UNIQUE INDEX CONCURRENTLY and DROP INDEX CONCURRENTLY too', () => {
    const files = [
      { tag: '0003_u', content: `CREATE UNIQUE INDEX CONCURRENTLY "u_idx" ON "public"."t" ("c");` },
      { tag: '0004_d', content: `DROP INDEX CONCURRENTLY IF EXISTS "public"."u_idx";` },
    ];
    expect(filesNeedingOnlineApply(files)).toEqual(['0003_u', '0004_d']);
  });

  it('flags a file where the CONCURRENTLY statement is not the first one', () => {
    const sql = [
      `ALTER TABLE "public"."t" ADD COLUMN "c" uuid;`,
      `--> statement-breakpoint`,
      `CREATE INDEX CONCURRENTLY "t_c_idx" ON "public"."t" ("c");`,
    ].join('\n');
    expect(filesNeedingOnlineApply([{ tag: '0005_m', content: sql }])).toEqual(['0005_m']);
  });

  it('does not flag a DO block that merely builds an index by EXECUTE', () => {
    // A dollar-quoted body is one statement and starts with DO, so it is safe
    // inside a transaction; only the top-level keyword decides the routing.
    const sql = `DO $mig$ BEGIN EXECUTE 'CREATE INDEX CONCURRENTLY x ON t (c)'; END $mig$;`;
    expect(filesNeedingOnlineApply([{ tag: '0006_p', content: sql }])).toEqual([]);
  });

  it('ignores a journal entry whose file is missing on disk', () => {
    expect(filesNeedingOnlineApply([{ tag: '0007_gone', content: null }])).toEqual([]);
  });

  it('returns the tags in journal order, once each', () => {
    const files = [
      { tag: '0008_a', content: `CREATE INDEX CONCURRENTLY "a1" ON "public"."t" ("c");` },
      { tag: '0008_b', content: `CREATE INDEX "b1" ON "public"."t" ("c");` },
      { tag: '0008_c', content: `CREATE INDEX CONCURRENTLY "c1" ON "public"."t" ("c");` },
    ];
    expect(filesNeedingOnlineApply(files)).toEqual(['0008_a', '0008_c']);
  });

  it('classifies the real 0118 by its statements, not its header prose', () => {
    // The header names CONCURRENTLY twice; that must never be what decides.
    expect(concurrentChunks(UP)).toHaveLength(100);
    expect(filesNeedingOnlineApply([{ tag: '0118_fk_column_indexes', content: UP }])).toEqual([
      '0118_fk_column_indexes',
    ]);
    // …and with the keyword removed from the builds, the same file must NOT be
    // flagged — which is exactly what the shipped header comment describes.
    const stripped = UP.replace(/CREATE INDEX CONCURRENTLY /g, 'CREATE INDEX ');
    expect(stripped).not.toBe(UP);
    expect(concurrentChunks(stripped)).toHaveLength(0);
    expect(filesNeedingOnlineApply([{ tag: '0118_fk_column_indexes', content: stripped }])).toEqual([]);
  });

  it('pins the drizzle behaviour this routing exists to work around', () => {
    // If a drizzle upgrade moves the pending-set loop out of one transaction,
    // this screen's premise needs re-checking — and this test is how we learn.
    const dialect = readFileSync(join(ROOT, 'node_modules/drizzle-orm/pg-core/dialect.js'), 'utf8');
    const migrateBody = dialect.slice(dialect.indexOf('async migrate('), dialect.indexOf('escapeName('));
    expect(migrateBody).toContain('await session.transaction(');
    expect(migrateBody).toMatch(/for await \(const migration of migrations\)/);
    expect(migrateBody).not.toContain('CONCURRENTLY');
  });
});

describe('chooseApplyRoute (#3301)', () => {
  it('keeps an empty ledger on the fresh-replay engine, which already handles CONCURRENTLY', () => {
    // The fresh branch replays every file through applyMigrationFile itself, so
    // it never opens the drizzle transaction the online route exists to avoid —
    // it wins even when the pending set is online-only.
    expect(chooseApplyRoute({ ledgerRowCount: 0, journalEntryCount: 142, onlineTags: ['0118_fk_column_indexes'] }))
      .toBe('fresh-replay');
    expect(chooseApplyRoute({ ledgerRowCount: 0, journalEntryCount: 142, onlineTags: [] }))
      .toBe('fresh-replay');
  });

  it('leaves a populated ledger with only blocking DDL on the drizzle migrator', () => {
    expect(chooseApplyRoute({ ledgerRowCount: 118, journalEntryCount: 142, onlineTags: [] }))
      .toBe('drizzle-incremental');
  });

  it('routes a populated ledger holding CONCURRENTLY DDL through the online engine', () => {
    expect(chooseApplyRoute({ ledgerRowCount: 118, journalEntryCount: 142, onlineTags: ['0118_fk_column_indexes'] }))
      .toBe('online-incremental');
  });

  it('does nothing on a journal-less folder rather than inventing a replay', () => {
    expect(chooseApplyRoute({ ledgerRowCount: 0, journalEntryCount: 0, onlineTags: [] }))
      .toBe('drizzle-incremental');
  });
});
