#!/usr/bin/env node
/**
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Empty-ledger recovery for `npm run db:migrate` (#1969, follow-up to #966).
 *
 * When a database already has schema but the drizzle ledger is empty
 * (provisioned via db:push/db:sync, or restored from a dump), db:migrate
 * "stamps" the journal as applied instead of replaying SQL over live
 * tables. Stamping without executing permanently cements any drift, so:
 *
 *   1. We log exactly WHICH markers matched, plus object counts, so an
 *      operator can spot a false positive before trusting the stamp.
 *   2. After stamping we verify every journal entry's headline objects
 *      (CREATE TABLE / ADD COLUMN / CREATE FUNCTION, minus anything later
 *      dropped or renamed) against the live catalog. On mismatch the stamp
 *      is rolled back and the run FAILS LOUDLY instead of reporting
 *      "All migrations applied successfully".
 *   3. Procedure docs live in docs/runbooks/migration-drift-recovery.md.
 */
import type { Pool } from 'pg';

export interface JournalEntry {
  tag: string;
  when: number;
}

export interface ExpectedState {
  /** table name -> set of column names */
  tables: Map<string, Set<string>>;
  functions: Set<string>;
}

const ID = '("[a-zA-Z_][\\w$]*"|[a-zA-Z_][\\w$]*)';
// Strictly a qualifier: only consumes input when a real `name.` prefix is present.
const QUALIFIED = '(?:(?:[a-zA-Z_][\\w$]*|"[a-zA-Z_][\\w$]*")\\s*\\.\\s*)?';

function unquote(raw: string): string {
  return raw.replace(/"/g, '');
}

/** Drop the rollback half of hand-written migrations (mirrors migrate.ts). */
export function stripDownSection(sql: string): string {
  const downIdx = sql.search(/^--\s*DOWN\s*$/m);
  return downIdx === -1 ? sql : sql.slice(0, downIdx);
}

/** Remove SQL comments so DDL keywords inside prose never match. */
export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/**
 * Replay the journal's DDL *as text* into an expected end state: tables,
 * columns added/altered after creation, and functions — tracking
 * ADD/DROP/RENAME so objects created early and dropped later are not
 * falsely expected. Columns declared inline inside a CREATE TABLE body are
 * deliberately NOT tracked (the headline objects that go missing on
 * push/restore drift are tables, functions, and ALTER ADD COLUMN — the
 * #966 class). Dynamic DDL inside DO $$ EXECUTE blocks is not parsed; the
 * guarded patterns below are deliberately conservative so verification can
 * only complain about objects a static statement promised.
 */
export function extractExpectedSchema(files: { tag: string; sql: string }[]): ExpectedState {
  const tables = new Map<string, Set<string>>();
  const functions = new Set<string>();

  const addTable = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Set());
  };
  const dropTable = (name: string) => {
    tables.delete(name);
  };
  const addColumn = (table: string, column: string) => {
    const cols = tables.get(table);
    if (cols) cols.add(column);
    // Table not tracked (created dynamically or by a pattern we ignore):
    // nothing to promise about its columns.
  };

  const createTableRe = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${QUALIFIED}${ID}\\s*\\(`, 'gi');
  const dropTableRe = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;\n]+?)(?:\s+CASCADE|\s+RESTRICT)?\s*(?:;|$)/gim;
  const addColumnRe = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${QUALIFIED}${ID}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ID}`, 'gi');
  const dropColumnRe = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${QUALIFIED}${ID}\\s+DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${ID}`, 'gi');
  const renameColumnRe = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${QUALIFIED}${ID}\\s+RENAME\\s+COLUMN\\s+${ID}\\s+TO\\s+${ID}`, 'gi');
  const renameTableRe = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${QUALIFIED}${ID}\\s+RENAME\\s+TO\\s+${ID}`, 'gi');
  const createFunctionRe = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${QUALIFIED}${ID}\\s*\\(`, 'gi');
  const dropFunctionRe = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([^;\n(]+)/gi;

  for (const { sql: rawSql } of files) {
    const sql = stripComments(stripDownSection(rawSql));

    for (const m of sql.matchAll(createTableRe)) addTable(unquote(m[1]!));
    for (const m of sql.matchAll(dropTableRe)) {
      for (const token of m[1]!.split(',')) {
        const parts = token.trim().split('.');
        const name = unquote(parts[parts.length - 1] ?? '');
        if (name) dropTable(name);
      }
    }
    for (const m of sql.matchAll(renameTableRe)) {
      const oldName = unquote(m[1]!);
      const newName = unquote(m[2]!);
      if (tables.has(oldName)) {
        tables.set(newName, tables.get(oldName)!);
        tables.delete(oldName);
      } else addTable(newName);
    }
    for (const m of sql.matchAll(addColumnRe)) addColumn(unquote(m[1]!), unquote(m[2]!));
    for (const m of sql.matchAll(dropColumnRe)) {
      tables.get(unquote(m[1]!))?.delete(unquote(m[2]!));
    }
    for (const m of sql.matchAll(renameColumnRe)) {
      const cols = tables.get(unquote(m[1]!));
      if (cols) {
        cols.delete(unquote(m[2]!));
        cols.add(unquote(m[3]!));
      }
    }
    for (const m of sql.matchAll(createFunctionRe)) functions.add(unquote(m[1]!));
    for (const m of sql.matchAll(dropFunctionRe)) {
      const parts = m[1]!.trim().split('.');
      const name = unquote(parts[parts.length - 1] ?? '');
      if (name) functions.delete(name);
    }
  }

  return { tables, functions };
}

export interface ActualState {
  tables: Set<string>;
  /** `${table}.${column}` */
  columns: Set<string>;
  functions: Set<string>;
}

/** Pure diff — unit-testable without a database. Returns human-readable issues. */
export function diffExpectedVsActual(expected: ExpectedState, actual: ActualState): string[] {
  const issues: string[] = [];
  const missingTables: string[] = [];

  for (const [table, cols] of expected.tables) {
    if (!actual.tables.has(table)) {
      missingTables.push(table);
      continue;
    }
    for (const col of cols) {
      if (!actual.columns.has(`${table}.${col}`)) issues.push(`column "${table}.${col}"`);
    }
  }
  for (const fn of expected.functions) {
    if (!actual.functions.has(fn)) issues.push(`function "${fn}()"`);
  }

  const out: string[] = [];
  if (missingTables.length) out.push(`missing tables: ${missingTables.map((t) => `"${t}"`).join(', ')}`);
  if (issues.length) out.push(`missing columns/functions: ${issues.join(', ')}`);
  return out;
}

async function loadActualState(pool: Pool): Promise<ActualState> {
  const [tablesRes, columnsRes, functionsRes] = await Promise.all([
    pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"),
    pool.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"),
    pool.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`),
  ]);
  return {
    tables: new Set(tablesRes.rows.map((r) => r.tablename)),
    columns: new Set(columnsRes.rows.map((r) => `${r.table_name}.${r.column_name}`)),
    functions: new Set(functionsRes.rows.map((r) => r.proname)),
  };
}

/**
 * Build the expected state from the on-disk journal files and diff it
 * against the live catalog. A missing migration file is itself an issue.
 */
export function verifyStampedLedger(
  files: { tag: string; sql: string | null }[],
  actual: ActualState,
): string[] {
  const readable: { tag: string; sql: string }[] = [];
  const issues: string[] = [];
  for (const f of files) {
    if (f.sql === null) {
      issues.push(`migration file "${f.tag}.sql" listed in the journal is not present on disk`);
      continue;
    }
    readable.push({ tag: f.tag, sql: f.sql });
  }
  issues.push(...diffExpectedVsActual(extractExpectedSchema(readable), actual));
  return issues;
}

/**
 * The empty-ledger recovery decision + stamping, extracted from migrate.ts.
 * Exits the process (code 1) on the refuse paths, matching the script's
 * existing style — the advisory lock is session-scoped and dies with it.
 */
export async function runRecoveryStamp(opts: {
  pool: Pool;
  journalEntries: JournalEntry[];
  readMigrationFile: (tag: string) => string | null;
  log?: (line: string) => void;
  fail?: (lines: string[]) => never;
}): Promise<'stamped' | 'fresh' | 'never'> {
  const { pool, journalEntries, readMigrationFile } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  const fail = opts.fail ?? ((lines: string[]): never => {
    for (const line of lines) console.error(line);
    process.exit(1);
  });

  const markerRes = await pool.query<{ api_key_usage: boolean; last_marker: boolean }>(`
    SELECT
      EXISTS (SELECT FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'api_key_usage') AS api_key_usage,
      EXISTS (SELECT FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'backup_records'
                AND column_name = 'last_verified_at') AS last_marker
  `);
  const earlyMarker = markerRes.rows[0]!.api_key_usage;
  const lastMarker = markerRes.rows[0]!.last_marker;
  const lastEntry = journalEntries[journalEntries.length - 1]!;

  if (!earlyMarker) {
    log('[migrate] Fresh database detected. Running all migrations...');
    return 'fresh';
  }

  if (!lastMarker) {
    // #1969: say exactly what we looked at before refusing, so the operator
    // knows whether the markers or the schema is the liar.
    fail([
      '[migrate] ERROR: Database has schema but it is NOT at the latest migration state.',
      `[migrate] Ledger is empty; marker check: early marker "api_key_usage" = PRESENT, ` +
      `last marker "backup_records.last_verified_at" (from ${lastEntry.tag}) = MISSING.`,
      '[migrate] This is usually a partial push/restore. Options:',
      '[migrate]   1. Run the remaining migrations manually and re-run db:migrate.',
      '[migrate]   2. Restore from a full backup.',
      '[migrate]   3. If the schema really is current, see docs/runbooks/migration-drift-recovery.md',
    ]);
  }

  // Both markers present — stamp, but first show WHAT justified the decision.
  const counts = await pool.query<{ tables: string; columns: string; functions: string }>(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public') AS columns,
      (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public') AS functions
  `);
  const c = counts.rows[0]!;
  log('[migrate] Recovery: schema already exists but the migration ledger is empty.');
  log('[migrate] Markers matched: table "api_key_usage", column "backup_records.last_verified_at"; ' +
    `public schema has ${c.tables} tables / ${c.columns} columns / ${c.functions} functions.`);
  log('[migrate] This database was provisioned with db:push/db:sync or restored');
  log('[migrate] from a dump. Stamping the journal as applied rather than replaying');
  log(`[migrate] it over live tables. Seeding ${journalEntries.length} entries...`);

  for (const entry of journalEntries) {
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
      [entry.tag, entry.when],
    );
  }
  log('[migrate] Recovery complete — no migration SQL was executed.');

  // #1969 ask 2: post-stamp verification. Never trust a stamp we just made.
  log('[migrate] Post-stamp verification: checking every journal entry\'s headline objects against the live schema...');
  const files = journalEntries.map((e) => ({ tag: e.tag, sql: readMigrationFile(e.tag) }));
  const actual = await loadActualState(pool);
  const issues = verifyStampedLedger(files, actual);

  if (issues.length > 0) {
    // Roll the stamp back so the ledger does not claim a state the schema
    // does not have; the next run re-enters recovery honestly.
    await pool.query(
      `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = ANY($1::text[])`,
      [journalEntries.map((e) => e.tag)],
    );
    const shown = issues.slice(0, 25);
    fail([
      `[migrate] ERROR: Post-stamp verification FAILED — ${issues.length} expected object(s) missing:`,
      ...shown.map((i) => `[migrate]   - ${i}`),
      ...(issues.length > shown.length ? [`[migrate]   ... ${issues.length - shown.length} more`] : []),
      '[migrate] The stamp was rolled back (ledger left empty). The schema does NOT match',
      '[migrate] the journal, so it was never fully migrated. Follow',
      '[migrate] docs/runbooks/migration-drift-recovery.md to apply the missing DDL,',
      '[migrate] then re-run db:migrate.',
    ]);
  }
  log('[migrate] Post-stamp verification passed — journal headline objects all present.');
  return 'stamped';
}
