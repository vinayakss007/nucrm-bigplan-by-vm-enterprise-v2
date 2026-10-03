/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unit tests for the fresh-replay helpers backing issues #2254 (empty ledger
 * after fresh replay → every db:migrate replays ~2,919 statements incl.
 * DROP TABLE) and #2235 (silently-swallowed statement errors + stripped
 * CONCURRENTLY). Pure logic + a fake runner — no database required.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ALREADY_EXISTS_CODES,
  applyMigrationFile,
  buildLedgerInsert,
  extractStatements,
  isConcurrentIndexStatement,
  isTxControlStatement,
  ledgerRowFor,
  partitionStatements,
  planMigrations,
  runFreshReplay,
  sha256Hex,
  shouldAbort,
  splitSql,
  type LedgerRowLike,
  type PlannedFile,
} from '../../scripts/migrate-fresh';

const CONTENT_A = 'CREATE TABLE alpha (id uuid);\n';
const CONTENT_B = 'ALTER TABLE alpha ADD COLUMN name text;';
const WHEN_A = 1700000000000;
const WHEN_B = 1700000001000;

function filesByTag(map: Record<string, string>) {
  return (tag: string) => map[tag] ?? null;
}

/** pg-like error factory */
function pgError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Fake runner: executes canned behaviour per SQL text. */
function fakeClient(behaviour?: (sql: string) => void) {
  const log: string[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      log.push(sql.replace(/\s+/g, ' ').slice(0, 90));
      void params;
      behaviour?.(sql);
      return { rows: [] };
    },
  };
  return { client, log };
}

describe('sha256Hex / ledgerRowFor — stamp format (#2254 fix #1)', () => {
  it('hashes file bytes exactly the way drizzle-orm readMigrationFiles() does', () => {
    // drizzle: crypto.createHash('sha256').update(fileText).digest('hex')
    const reference = createHash('sha256').update(CONTENT_A).digest('hex');
    expect(sha256Hex(CONTENT_A)).toBe(reference);
    expect(sha256Hex(Buffer.from(CONTENT_A, 'utf-8'))).toBe(reference);
  });

  it('uses journal entry.when (ms) as created_at', () => {
    const row = ledgerRowFor({ tag: '0000_init', when: WHEN_A }, CONTENT_A);
    expect(row).toEqual({ tag: '0000_init', hash: sha256Hex(CONTENT_A), createdAt: WHEN_A });
  });

  it('falls back to file mtime, then wall clock, when the journal has no `when`', () => {
    const byMtime = ledgerRowFor({ tag: 'x' }, CONTENT_A, 123456.7);
    expect(byMtime.createdAt).toBe(123457);
    const byNow = ledgerRowFor({ tag: 'x' }, CONTENT_A, null, 999999);
    expect(byNow.createdAt).toBe(999999);
  });
});

describe('planMigrations — already-applied vs replay (#2254 fix #1, idempotent)', () => {
  const entries = [
    { tag: '0000_a', when: WHEN_A },
    { tag: '0001_b', when: WHEN_B },
  ];
  const read = filesByTag({ '0000_a': CONTENT_A, '0001_b': CONTENT_B });

  it('empty ledger → every entry is a replay target', () => {
    const plan = planMigrations(entries, [], read);
    expect(plan.map((p) => p.action)).toEqual(['replay', 'replay']);
    expect(plan[0]!.hash).toBe(sha256Hex(CONTENT_A));
  });

  it('recognises stamping by created_at (journal `when`) OR by hash', () => {
    const byCreatedAt: LedgerRowLike[] = [{ hash: 'recovery-stamp-tag', createdAt: WHEN_A }];
    const byHash: LedgerRowLike[] = [{ hash: sha256Hex(CONTENT_B), createdAt: 1 }];
    const plan = planMigrations(entries, [...byCreatedAt, ...byHash], read);
    expect(plan.map((p) => p.action)).toEqual(['skip-stamped', 'skip-stamped']);
  });

  it('is idempotent: planning against a ledger stamped from the plan skips everything (double-migrate = no-op)', () => {
    const first = planMigrations(entries, [], read);
    const stamped: LedgerRowLike[] = first.map((p) => ({ hash: p.hash!, createdAt: p.createdAt }));
    const second = planMigrations(entries, stamped, read);
    expect(second.every((p) => p.action === 'skip-stamped')).toBe(true);
  });

  it('marks journal entries with no file on disk as missing-file', () => {
    const plan = planMigrations([{ tag: '0099_ghost', when: 5 }], [], read);
    expect(plan[0]!.action).toBe('missing-file');
    expect(plan[0]!.hash).toBeNull();
  });
});

describe('buildLedgerInsert — idempotent stamp SQL', () => {
  const row = { hash: 'abc', createdAt: 123 };

  it('inserts (hash, created_at) guarded by NOT EXISTS on created_at only (drizzle keys on created_at; duplicate-content files must still stamp)', () => {
    const { text, params } = buildLedgerInsert(row);
    expect(text).toContain('INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")');
    expect(text).toContain('WHERE NOT EXISTS');
    expect(text).toMatch(/"created_at" = \$2/);
    expect(text).not.toMatch(/NOT EXISTS[\s\S]*"hash" = \$1/); // hash must NOT suppress a distinct entry
    expect(params).toEqual(['abc', 123]);
  });

  it('includes fk_updates only when the column exists — 0 for numeric, false for boolean', () => {
    const numeric = buildLedgerInsert(row, 'bigint');
    expect(numeric.text).toContain('"fk_updates"');
    expect(numeric.params).toEqual(['abc', 123, 0]);
    const bool = buildLedgerInsert(row, 'boolean');
    expect(bool.params).toEqual(['abc', 123, false]);
  });
});

describe('shouldAbort — fail loud (#2235 fix #1)', () => {
  it('tolerates ONLY allowlisted "already exists" errors', () => {
    expect([...ALREADY_EXISTS_CODES].sort()).toEqual(['42710', '42P07']);
    expect(shouldAbort(pgError('42P07', 'relation "users" already exists'))).toBe(false);
    expect(shouldAbort(pgError('42710', 'policy "x" for table "y" already exists'))).toBe(false);
  });

  it('aborts on the old blanket-tolerated codes (#2235: undefined_column/table/object)', () => {
    expect(shouldAbort(pgError('42703', 'column "role_slug" does not exist'))).toBe(true);
    expect(shouldAbort(pgError('42P01', 'table "ghost" does not exist'))).toBe(true);
    expect(shouldAbort(pgError('42P11', 'constraint does not exist'))).toBe(true);
  });

  it('aborts on unknown-code errors, nulls, and allowlisted codes with a mismatched message', () => {
    expect(shouldAbort(new Error('boom'))).toBe(true);
    expect(shouldAbort(undefined)).toBe(true);
    expect(shouldAbort(pgError('42P07', 'something else entirely'))).toBe(true);
  });

  it('zero-table build (#2235 AC): tolerates ONLY "does not exist" file-order quirks', () => {
    const fresh = { zeroTableFreshBuild: true };
    expect(shouldAbort(pgError('42703', 'column "tenant_id" does not exist'), fresh)).toBe(false);
    expect(shouldAbort(pgError('42P01', 'table "x" does not exist'), fresh)).toBe(false);
    expect(shouldAbort(pgError('42P11', 'constraint "x" does not exist'), fresh)).toBe(false);
    // even in a zero-table build, anything else aborts:
    expect(shouldAbort(pgError('42883', 'function gen_random_uuid() does not exist'), fresh)).toBe(true); // wrong SQLSTATE
    expect(shouldAbort(pgError('42703', 'column referenced in error state'), fresh)).toBe(true); // message gate
    expect(shouldAbort(new Error('syntax error at or near "SELECTT"'), fresh)).toBe(true);
  });

  it('non-fresh DB (tables present): 42703/42P01/42P11 ABORT — the old false-green is gone', () => {
    expect(shouldAbort(pgError('42703', 'column "role_slug" does not exist'), { zeroTableFreshBuild: false })).toBe(true);
    expect(shouldAbort(pgError('42P01', 'table "x" does not exist'), {})).toBe(true);
  });
});

describe('splitSql / extractStatements', () => {
  it('does not split on semicolons inside dollar-quoted blocks or string literals', () => {
    const sql = `CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql; INSERT INTO t VALUES ('a;b');`;
    const stmts = splitSql(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain('RETURN 1; END;');
    expect(stmts[1]!).toContain("'a;b'");
  });

  it('strips the DOWN section and honours statement-breakpoints', () => {
    const sql = [
      'CREATE TABLE up_only (id uuid);',
      '--> statement-breakpoint',
      'CREATE TABLE also_up (id uuid);',
      '-- DOWN',
      'DROP TABLE up_only;',
    ].join('\n');
    const stmts = extractStatements(sql);
    expect(stmts.join(' ')).toContain('up_only');
    expect(stmts).toHaveLength(2);
    expect(stmts.some((s) => /DROP TABLE/.test(s))).toBe(false);
  });

  it('drops embedded transaction-control statements but keeps CONCURRENTLY (#2235)', () => {
    const sql = 'BEGIN;\nALTER TABLE forms ADD COLUMN views_count int;\nCOMMIT;\nCREATE INDEX CONCURRENTLY idx_x ON forms(id);';
    const stmts = extractStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts.some((s) => isTxControlStatement(s))).toBe(false);
    expect(stmts[1]).toContain('CONCURRENTLY'); // preserved, not stripped
  });

  it('isTxControlStatement sees through comments and casing', () => {
    expect(isTxControlStatement('-- wrap up\ncommit;')).toBe(true);
    expect(isTxControlStatement('BEGIN TRANSACTION;')).toBe(true);
    expect(isTxControlStatement('CREATE TABLE commit_log (id int);')).toBe(false);
  });

  it('isConcurrentIndexStatement covers create/drop/reindex concurrently', () => {
    expect(isConcurrentIndexStatement('CREATE UNIQUE INDEX CONCURRENTLY u ON t(c);')).toBe(true);
    expect(isConcurrentIndexStatement('DROP INDEX CONCURRENTLY IF EXISTS ix;')).toBe(true);
    expect(isConcurrentIndexStatement('CREATE INDEX ix ON t(c);')).toBe(false);
    expect(isConcurrentIndexStatement('-- CREATE INDEX CONCURRENTLY note\nSELECT 1;')).toBe(false);
  });

  it('partitionStatements groups tx-safe runs and isolates CONCURRENTLY', () => {
    const chunks = partitionStatements([
      'ALTER TABLE a ADD c int;',
      'CREATE INDEX CONCURRENTLY i ON a(c);',
      'UPDATE a SET c = 1;',
    ]);
    expect(chunks).toEqual([
      { type: 'tx', statements: ['ALTER TABLE a ADD c int;'] },
      { type: 'nontransactional', statement: 'CREATE INDEX CONCURRENTLY i ON a(c);' },
      { type: 'tx', statements: ['UPDATE a SET c = 1;'] },
    ]);
  });
});

describe('applyMigrationFile — transactions, savepoints, abort (#2254 fix #2)', () => {
  it('wraps tx chunks in BEGIN/COMMIT with per-statement savepoints', async () => {
    const { client, log } = fakeClient();
    const stats = await applyMigrationFile(client, 'f.sql', ['SELECT 1;', 'SELECT 2;']);
    expect(stats).toEqual({ applied: 2, skipped: 0, skippedZeroTableQuirk: 0, concurrent: 0, fatal: null });
    expect(log).toEqual(['BEGIN', 'SAVEPOINT sp_1', 'SELECT 1;', 'SAVEPOINT sp_2', 'SELECT 2;', 'COMMIT']);
  });

  it('runs CONCURRENTLY outside the transaction, keyword intact (#2235 fix #2)', async () => {
    const { client, log } = fakeClient();
    const stats = await applyMigrationFile(client, 'f.sql', [
      'ALTER TABLE a ADD c int;',
      'CREATE INDEX CONCURRENTLY i ON a(c);',
    ]);
    expect(stats.concurrent).toBe(1);
    expect(log).toEqual([
      'BEGIN', 'SAVEPOINT sp_1', 'ALTER TABLE a ADD c int;', 'COMMIT',
      'CREATE INDEX CONCURRENTLY i ON a(c);',
    ]);
    expect(log.some((l) => /CONCURRENTLY/.test(l))).toBe(true); // never stripped
  });

  it('tolerates "already exists" via savepoint rollback and continues the file', async () => {
    const { client, log } = fakeClient((sql) => {
      if (sql.includes('CREATE TABLE dup')) throw pgError('42P07', 'relation "dup" already exists');
    });
    const stats = await applyMigrationFile(client, 'f.sql', [
      'CREATE TABLE dup (id int);',
      'CREATE TABLE next_one (id int);',
    ]);
    expect(stats.fatal).toBeNull();
    expect(stats.skipped).toBe(1);
    expect(stats.applied).toBe(1);
    expect(log).toContain('ROLLBACK TO sp_1');
    expect(log).toContain('COMMIT');
  });

  it('ABORTS the file on a non-allowlisted error: rolls the tx back, stops, reports fatal', async () => {
    const { client, log } = fakeClient((sql) => {
      if (sql.includes('missing_column')) throw pgError('42703', 'column "missing_column" does not exist');
    });
    const stats = await applyMigrationFile(client, 'f.sql', [
      'SELECT 1;',
      'UPDATE t SET missing_column = 1;',
      'SELECT 2; -- must never run',
    ]);
    expect(stats.fatal).toContain('[f.sql] 42703');
    expect(log).toContain('ROLLBACK');
    expect(log.some((l) => l.includes('SELECT 2'))).toBe(false);
    expect(log).not.toContain('COMMIT');
  });

  it('zero-table build: tolerates the 0004 webhook_queue quirk, counts it separately, and continues', async () => {
    const { client } = fakeClient((sql) => {
      if (sql.includes('idx_webhook_queue_tenant')) throw pgError('42703', 'column "tenant_id" does not exist');
    });
    const stats = await applyMigrationFile(client, '0004_fix_duplicate_tables.sql', [
      'CREATE TABLE IF NOT EXISTS "webhook_queue" (id uuid);',
      'CREATE INDEX IF NOT EXISTS "idx_webhook_queue_tenant" ON "webhook_queue" USING btree ("tenant_id");',
      'CREATE INDEX IF NOT EXISTS "idx_webhook_queue_status" ON "webhook_queue" USING btree ("status");',
    ], { zeroTableFreshBuild: true });
    expect(stats.fatal).toBeNull();
    expect(stats.skippedZeroTableQuirk).toBe(1);
    expect(stats.applied).toBe(2);
  });

  it('same quirk error on a partial rerun (tables present) ABORTS (#2235)', async () => {
    const { client } = fakeClient((sql) => {
      if (sql.includes('idx_webhook_queue_tenant')) throw pgError('42703', 'column "tenant_id" does not exist');
    });
    const stats = await applyMigrationFile(client, '0004_fix_duplicate_tables.sql', [
      'CREATE INDEX IF NOT EXISTS "idx_webhook_queue_tenant" ON "webhook_queue" USING btree ("tenant_id");',
      'SELECT 2; -- must never run',
    ], { zeroTableFreshBuild: false });
    expect(stats.fatal).toContain('42703');
  });
});

describe('runFreshReplay — fake-runner orchestration (#2254 / #2235)', () => {
  const mkPlan = (tags: Record<string, string>, ledger: LedgerRowLike[]): PlannedFile[] =>
    planMigrations(
      Object.entries(tags).map(([tag, when]) => ({ tag, when: Number(when) })),
      ledger,
      filesByTag({
        '0000_a': CONTENT_A,
        '0001_b': CONTENT_B,
      }),
    );

  it('stamps one ledger row per replayed file, with drizzle-format hash', async () => {
    const { client } = fakeClient();
    const stamps: { tag: string; hash: string; createdAt: number }[] = [];
    const plan = mkPlan({ '0000_a': String(WHEN_A), '0001_b': String(WHEN_B) }, []);
    const stats = await runFreshReplay({
      client,
      plan,
      readFile: filesByTag({ '0000_a': CONTENT_A, '0001_b': CONTENT_B }),
      stamp: async (row) => { stamps.push(row); },
      log: () => {},
    });
    expect(stats.fatal).toEqual([]);
    expect(stamps).toEqual([
      { tag: '0000_a', hash: sha256Hex(CONTENT_A), createdAt: WHEN_A },
      { tag: '0001_b', hash: sha256Hex(CONTENT_B), createdAt: WHEN_B },
    ]);
    expect(stats.stampedTags).toEqual(['0000_a', '0001_b']);
  });

  it('skips files already stamped — a second replay run executes zero statements (double-migrate no-op)', async () => {
    const { client, log } = fakeClient();
    const first = mkPlan({ '0000_a': String(WHEN_A) }, []);
    const ledger = first.map((p) => ({ hash: p.hash!, createdAt: p.createdAt }));
    const second = mkPlan({ '0000_a': String(WHEN_A) }, ledger);
    const stats = await runFreshReplay({
      client,
      plan: second,
      readFile: filesByTag({ '0000_a': CONTENT_A }),
      stamp: async () => { throw new Error('must not re-stamp'); },
      log: () => {},
    });
    expect(stats.replayTargets).toBe(0);
    expect(stats.applied).toBe(0);
    expect(log.filter((l) => !/BEGIN|COMMIT|SAVEPOINT/.test(l))).toEqual([]); // only tx control could appear; none did
  });

  it('a failing statement aborts the WHOLE run: later files never execute, failing file is not stamped', async () => {
    const attempted: string[] = [];
    const { client } = fakeClient((sql) => {
      if (sql.includes('DROP TABLE guarded')) throw pgError('42P01', 'table "guarded" does not exist');
    });
    const stamps: string[] = [];
    const plan = mkPlan({ '0000_a': String(WHEN_A), '0001_b': String(WHEN_B) }, []);
    // Make file B destructive-failing:
    const readBBroken = (tag: string) =>
      tag === '0001_b' ? 'DROP TABLE guarded;' : CONTENT_A;
    const stats = await runFreshReplay({
      client,
      plan,
      readFile: readBBroken,
      stamp: async (row) => { stamps.push(row.tag); },
      log: () => {},
      // override hash for B after planning is irrelevant — stamp uses plan hash; fine.
    });
    void attempted;
    expect(stamps).toEqual(['0000_a']); // A applied + stamped before B blew up
    expect(stats.fatal.length).toBe(1);
    expect(stats.fatal[0]).toContain('42P01');
    expect(stats.stampedTags).toEqual(['0000_a']);
  });

  it('treats a missing migration file as fatal instead of warning-and-continuing', async () => {
    const { client } = fakeClient();
    const plan = planMigrations([{ tag: '0099_ghost', when: 5 }], [], () => null);
    const stats = await runFreshReplay({
      client,
      plan,
      readFile: () => null,
      stamp: async () => { throw new Error('must not stamp'); },
      log: () => {},
    });
    expect(stats.fatal[0]).toContain('0099_ghost.sql');
  });

  it('dry-run counts statements but executes and stamps nothing', async () => {
    const { client, log } = fakeClient();
    const plan = mkPlan({ '0000_a': String(WHEN_A) }, []);
    const stats = await runFreshReplay({
      client,
      plan,
      readFile: filesByTag({ '0000_a': CONTENT_A }),
      stamp: async () => { throw new Error('must not stamp in dry run'); },
      log: () => {},
      dryRun: true,
    });
    expect(stats.applied).toBe(0);
    expect(stats.stampedTags).toEqual([]);
    expect(stats.replayTargets).toBe(1);
    expect(log).toEqual([]);
  });
});
