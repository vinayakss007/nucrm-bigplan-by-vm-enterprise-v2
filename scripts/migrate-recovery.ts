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
 *      is rolled back and the run FAILS LOUDLY, naming the count and the
 *      OWNING JOURNAL ENTRY of every missing object, instead of reporting
 *      "All migrations applied successfully".
 *   3. Procedure docs live in docs/runbooks/migration-drift-recovery.md.
 *
 * #2450 added the two things this file was missing, and they are the same
 * thing seen from either end. "Provisioned via db:push/db:sync" and
 * "restored from a dump" were treated as one case above, but they are not:
 * `drizzle-kit push` builds tables and columns from `drizzle/schema/*` only,
 * so a pushed schema has ZERO rows in `pg_policy` — every tenant-isolation
 * guarantee in this database is an RLS policy, so a pushed schema is
 * unprotected — while a dump of a migrated database carries those policies.
 * The stamp is defensible for the dump and indefensible for the push, and it
 * was being applied to both. So:
 *
 *   4. Before stamping we classify the provisioning from `pg_policy`
 *      (`classifyProvisioning`). A push-provisioned schema is refused up
 *      front, naming the object classes the journal contributes and the
 *      command that builds them (`npm run db:bootstrap`). We never stamp,
 *      verify, fail and roll back to leave a database labelled as neither.
 */
import type { Pool } from 'pg';

export interface JournalEntry {
  tag: string;
  when: number;
}

export interface ExpectedTable {
  /** journal tag whose CREATE TABLE promised this table */
  owner: string;
  /** column name -> journal tag whose ALTER ... ADD COLUMN promised it */
  columns: Map<string, string>;
}

export interface ExpectedState {
  tables: Map<string, ExpectedTable>;
  /**
   * Function name -> journal tag whose CREATE FUNCTION promised it. Owners are
   * the LAST entry that creates an object, so a `CREATE OR REPLACE` in a later
   * file claims what an earlier file first wrote: the tag reported is the file
   * whose DDL the operator has to fix, not the one they have to `grep` for.
   */
  functions: Map<string, string>;
}

/**
 * One headline object the journal promised and the live catalog does not
 * have. `owner` is the point of the whole struct (#2450 AC4): a reader who
 * is handed 21 bare function signatures has to go find which migration
 * writes them, and that search is the difference between a reportable
 * defect and a dead end.
 */
export interface MissingObject {
  kind: 'table' | 'column' | 'function' | 'migration-file';
  /** `table`, `table.column`, `fn()` or the journal tag */
  name: string;
  owner: string;
}

export interface ProvisioningShape {
  policies: number;
  rlsEnabledTables: number;
  tables: number;
  columns: number;
  functions: number;
}

export type ProvisioningKind = 'push' | 'dump';

/**
 * Was this schema built by `drizzle-kit push`, or is it a dump of a database
 * that ran the journal? `pg_policy` is the tell: RLS policies exist only
 * because hand-written migration files create them (32 files, 192 CREATE
 * POLICY statements), and push has no notion of them — and stamping a schema
 * that never executed the journal would label an unprotected database migrated.
 *
 * The bare count is not enough, though, because a policy is not proof on its
 * own: `tests/integration/superadmin-panel-sql.test.ts` enables RLS and installs
 * one hand-typed policy on `activities` to prove an RLS behaviour, and never
 * restores the set it dropped. So a *pushed* schema that has run the integration
 * suite holds exactly one policy over one RLS-enabled table with every object
 * the journal contributes still missing (#2455). What says the journal ran is
 * that RLS covers the schema, not that a policy exists somewhere: measured on
 * databases that executed the journal, 225 of 227 tables wear it (production,
 * and a CI schema built by `apply-rls-ci`); a pushed schema is 0 of 227.
 */
export const MIN_RLS_TABLE_RATIO = 0.5;

export function classifyProvisioning(shape: ProvisioningShape): ProvisioningKind {
  if (shape.tables === 0 || shape.policies === 0) return 'push';
  return shape.rlsEnabledTables / shape.tables >= MIN_RLS_TABLE_RATIO ? 'dump' : 'push';
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
  const tables = new Map<string, ExpectedTable>();
  const functions = new Map<string, string>();

  const addTable = (name: string, owner: string) => {
    if (!tables.has(name)) tables.set(name, { owner, columns: new Map() });
  };
  const dropTable = (name: string) => {
    tables.delete(name);
  };
  const addColumn = (table: string, column: string, owner: string) => {
    const cols = tables.get(table)?.columns;
    if (cols) cols.set(column, owner);
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

  for (const { tag, sql: rawSql } of files) {
    const sql = stripComments(stripDownSection(rawSql));

    for (const m of sql.matchAll(createTableRe)) addTable(unquote(m[1]!), tag);
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
      const moved = tables.get(oldName);
      if (moved) {
        tables.set(newName, moved);
        tables.delete(oldName);
      } else addTable(newName, tag);
    }
    for (const m of sql.matchAll(addColumnRe)) addColumn(unquote(m[1]!), unquote(m[2]!), tag);
    for (const m of sql.matchAll(dropColumnRe)) {
      tables.get(unquote(m[1]!))?.columns.delete(unquote(m[2]!));
    }
    for (const m of sql.matchAll(renameColumnRe)) {
      const cols = tables.get(unquote(m[1]!))?.columns;
      if (cols) {
        const oldOwner = cols.get(unquote(m[2]!));
        cols.delete(unquote(m[2]!));
        cols.set(unquote(m[3]!), oldOwner ?? tag);
      }
    }
    for (const m of sql.matchAll(createFunctionRe)) functions.set(unquote(m[1]!), tag);
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

/** Pure diff — unit-testable without a database. One record per promised object that is not there. */
export function diffExpectedVsActual(expected: ExpectedState, actual: ActualState): MissingObject[] {
  const missing: MissingObject[] = [];

  for (const [table, { owner, columns }] of expected.tables) {
    if (!actual.tables.has(table)) {
      // A table that is not there makes every column the journal added to it
      // absent too, but reporting the table is the whole truth: the operator
      // fixes one object, not twenty.
      missing.push({ kind: 'table', name: table, owner });
      continue;
    }
    for (const [col, colOwner] of columns) {
      if (!actual.columns.has(`${table}.${col}`)) {
        missing.push({ kind: 'column', name: `${table}.${col}`, owner: colOwner });
      }
    }
  }
  for (const [fn, fnOwner] of expected.functions) {
    if (!actual.functions.has(fn)) missing.push({ kind: 'function', name: `${fn}()`, owner: fnOwner });
  }
  return missing;
}

/**
 * Group by the journal entry that promised each object, biggest gap first.
 * This is the shape an operator acts on: "#2450's 21 missing functions are
 * 16 from 0032 and 5 from four other files" is a sentence, where a flat list
 * of signatures is a chore.
 */
export function groupMissingByOwner(missing: MissingObject[]): { owner: string; objects: MissingObject[] }[] {
  const byOwner = new Map<string, MissingObject[]>();
  for (const m of missing) {
    const list = byOwner.get(m.owner);
    if (list) list.push(m);
    else byOwner.set(m.owner, [m]);
  }
  return [...byOwner.entries()]
    .map(([owner, objects]) => ({ owner, objects }))
    .sort((a, b) => b.objects.length - a.objects.length || a.owner.localeCompare(b.owner));
}

/**
 * `• 0032_missing_db_functions.sql — 16 object(s): function "purge_trash()", …`
 * — one line per journal entry, with the object list capped so a 400-object
 * gap stays readable; the counts above the list are the full truth.
 */
export function formatMissingObjects(
  missing: MissingObject[],
  { maxGroups = 12, maxObjects = 10 }: { maxGroups?: number; maxObjects?: number } = {},
): string[] {
  const groups = groupMissingByOwner(missing);
  const lines = groups.slice(0, maxGroups).map((g) => {
    const names = g.objects.map((o) => `"${o.name}"`);
    const shown = names.slice(0, maxObjects).join(', ');
    return `${g.owner} — ${g.objects.length} object(s): ${shown}` +
      (names.length > maxObjects ? `, … ${names.length - maxObjects} more` : '');
  });
  if (groups.length > maxGroups) {
    lines.push(`… ${groups.length - maxGroups} more journal entr(ies) with missing objects`);
  }
  return lines;
}

export async function loadActualState(pool: Pool): Promise<ActualState> {
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
): MissingObject[] {
  const readable: { tag: string; sql: string }[] = [];
  const missing: MissingObject[] = [];
  for (const f of files) {
    if (f.sql === null) {
      missing.push({
        kind: 'migration-file',
        name: `${f.tag}.sql (listed in the journal, not on disk)`,
        owner: f.tag,
      });
      continue;
    }
    readable.push({ tag: f.tag, sql: f.sql });
  }
  missing.push(...diffExpectedVsActual(extractExpectedSchema(readable), actual));
  return missing;
}

/**
 * The live catalog counts that decide a stamp (#2450): `pg_policy` for the
 * provisioning class, plus the object counts quoted in both the stamp log and
 * the refusal. One round trip; every count is a string from COUNT(*).
 */
export async function loadProvisioningShape(pool: Pool): Promise<ProvisioningShape> {
  const res = await pool.query<{
    tables: string; columns: string; functions: string; policies: string; rls_enabled_tables: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public') AS columns,
      (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public') AS functions,
      (SELECT COUNT(*) FROM pg_policy pl JOIN pg_class c ON c.oid = pl.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public') AS policies,
      (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relrowsecurity) AS rls_enabled_tables
  `);
  const r = res.rows[0]!;
  return {
    tables: Number(r.tables),
    columns: Number(r.columns),
    functions: Number(r.functions),
    policies: Number(r.policies),
    rlsEnabledTables: Number(r.rls_enabled_tables),
  };
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

  // Both markers present. Before stamping, find out what KIND of pre-existing
  // schema this is (#2450) — the markers only prove the journal reached
  // `backup_records`, not that it ever ran here.
  const shape = await loadProvisioningShape(pool);
  log('[migrate] Recovery: schema already exists but the migration ledger is empty.');
  log('[migrate] Markers matched: table "api_key_usage", column "backup_records.last_verified_at"; ' +
    `public schema has ${shape.tables} tables / ${shape.columns} columns / ${shape.functions} functions / ` +
    `${shape.policies} RLS policies over ${shape.rlsEnabledTables} RLS-enabled tables.`);

  if (classifyProvisioning(shape) === 'push') {
    // Refuse NOW, not after the fact. Stamping, verifying, failing and rolling
    // back is the #2450 bug: it spends a "Recovery complete" line, exits 1,
    // and leaves the database labelled as neither migrated nor unmigrated.
    fail([
      '[migrate] ERROR: this schema was built by `drizzle-kit push` (db:push/db:sync), not by these migrations.',
      `[migrate] Evidence: pg_policy holds ${shape.policies} row(s) and RLS is enabled on` +
      ` ${shape.rlsEnabledTables} of ${shape.tables} tables — a schema whose journal ever ran` +
      ' wears it on nearly all of them (measured: 225 of 227). Push creates tables and' +
      ' columns from drizzle/schema/* only, so every RLS policy, SQL function and' +
      ' hand-written index the journal contributes is absent here — while the' +
      ' markers this branch matches on are all present.',
      '[migrate] Stamping would label an UNPROTECTED database as fully migrated; and',
      '[migrate] post-stamp verification would then (correctly) fail and roll the stamp back.',
      '[migrate] Refusing BEFORE stamping: no ledger row was written, no migration SQL ran.',
      '[migrate] Build this database from the journal instead — on an EMPTY database:',
      '[migrate]   npm run db:bootstrap    (replays every journal entry, stamps the ledger,',
      '[migrate]    then verifies RLS coverage and headline objects by query and fails if short)',
      '[migrate] A pushed schema is a throwaway CI shape; drop it and bootstrap rather than',
      '[migrate] reconciling it. If this database holds real data, follow',
      '[migrate] docs/runbooks/migration-drift-recovery.md instead.',
      '[migrate] CI runs `node scripts/apply-rls-ci.mjs` over a pushed schema on purpose and',
      '[migrate] never calls db:migrate — that is not an install path.',
    ]);
  }

  log(`[migrate] Journal-shaped schema (RLS on ${shape.rlsEnabledTables} of ${shape.tables} tables). Stamping the journal`);
  log(`[migrate] as applied rather than replaying it over live tables. Seeding ${journalEntries.length} entries...`);

  for (const entry of journalEntries) {
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
      [entry.tag, entry.when],
    );
  }
  log('[migrate] Recovery complete — no migration SQL was executed.');

  // #1969 ask 2 / #2450 AC4: post-stamp verification. Never trust a stamp we
  // just made, and when it fails say WHICH journal entry promised what, not
  // just a flat list of signatures the reader has to go and locate by hand.
  log('[migrate] Post-stamp verification: checking every journal entry\'s headline objects against the live schema...');
  const files = journalEntries.map((e) => ({ tag: e.tag, sql: readMigrationFile(e.tag) }));
  const actual = await loadActualState(pool);
  const missing = verifyStampedLedger(files, actual);

  if (missing.length > 0) {
    // Roll the stamp back so the ledger does not claim a state the schema
    // does not have; the next run re-enters recovery honestly.
    await pool.query(
      `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = ANY($1::text[])`,
      [journalEntries.map((e) => e.tag)],
    );
    const groups = groupMissingByOwner(missing);
    fail([
      `[migrate] ERROR: Post-stamp verification FAILED — ${missing.length} expected object(s)` +
      ` missing, promised by ${groups.length} journal entr(ies):`,
      ...formatMissingObjects(missing).map((line) => `[migrate]   - ${line}`),
      '[migrate] The stamp was rolled back (ledger left empty). The schema does NOT match',
      '[migrate] the journal, so it was never fully migrated. Follow',
      '[migrate] docs/runbooks/migration-drift-recovery.md to apply the missing DDL,',
      '[migrate] then re-run db:migrate.',
    ]);
  }
  log('[migrate] Post-stamp verification passed — journal headline objects all present.');
  return 'stamped';
}
