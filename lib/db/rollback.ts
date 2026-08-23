/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Migration Rollback Engine (issue #640)
 *
 * The project ships rollback SQL in two different conventions:
 *   1. A sibling `<tag>.down.sql` file next to `<tag>.sql`.
 *   2. An inline section inside `<tag>.sql`, delimited by `-- DOWN` and
 *      `-- END DOWN` marker comments.
 *
 * Until now nothing could actually execute either of them: the live runner
 * (`scripts/migrate.ts`) delegates to drizzle's `migrate()` which has no
 * rollback concept, and the only script that understood `-- DOWN` sections was
 * orphaned. This module is the executable rollback path, kept in `lib/` (rather
 * than `scripts/`, which is excluded from typecheck) so it is type-checked and
 * unit-testable.
 */

import fs from 'fs';
import path from 'path';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db/pool';
import { withMigrationLock, type MigrationLockOptions } from '@/lib/db/migration-safety';
import { logger } from '@/lib/logger';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

/** Default location of the drizzle migrations folder (relative to repo root). */
export const DEFAULT_MIGRATIONS_DIR = path.join('drizzle', 'migrations');

/** Fully qualified drizzle migration state table. */
export const MIGRATIONS_TABLE = '"drizzle"."__drizzle_migrations"';

/** Marker that opens an inline rollback section. */
const DOWN_START_MARKER = /^[ \t]*--[ \t]*DOWN[ \t]*$/im;
/** Marker that closes an inline rollback section. */
const DOWN_END_MARKER = /^[ \t]*--[ \t]*END[ \t]+DOWN[ \t]*$/im;

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

/** Where a migration's rollback SQL came from. */
export type RollbackSource = 'down-file' | 'inline';

/** A single entry of `drizzle/migrations/meta/_journal.json`. */
export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

/** Resolved rollback SQL for a migration tag. */
export interface ResolvedRollback {
  tag: string;
  sql: string;
  source: RollbackSource;
  /** Absolute path of the file the SQL was read from. */
  file: string;
}

/** A migration recorded in `drizzle.__drizzle_migrations`. */
export interface AppliedMigration {
  /** Journal tag, e.g. `0039_rls_fail_closed_policy`. */
  tag: string;
  /** Journal index, or -1 when the row could not be correlated. */
  idx: number;
  /** Value of the `hash` column. */
  hash: string;
  /** Value of the `created_at` column, as a Date (null when unparsable). */
  appliedAt: Date | null;
  /** True when rollback SQL exists for this migration. */
  hasRollback: boolean;
  /** Primary key of the state row, used to delete it on rollback. */
  id: number;
}

/** Per-migration rollback availability. */
export interface RollbackCoverageEntry {
  tag: string;
  idx: number;
  hasRollback: boolean;
  source: RollbackSource | null;
}

/** Result of {@link verifyRollbackCoverage}. */
export interface RollbackCoverage {
  total: number;
  covered: number;
  missing: number;
  /** Percentage of migrations with rollback SQL, rounded to one decimal. */
  coveragePercent: number;
  entries: RollbackCoverageEntry[];
  withRollback: string[];
  withoutRollback: string[];
}

/** Options for {@link rollbackMigration}. */
export interface RollbackOptions {
  /** Execute against the database but roll the transaction back instead of committing. */
  dryRun?: boolean;
  /** Allow rolling back a migration that is not the most recently applied one. */
  force?: boolean;
  /** Override the migrations directory (used by tests). */
  migrationsDir?: string;
  /** Advisory lock tuning, forwarded to `withMigrationLock`. */
  lockOptions?: MigrationLockOptions;
}

/** Result of {@link rollbackMigration}. */
export interface RollbackResult {
  tag: string;
  /** True when the rollback was committed. False for a dry run. */
  committed: boolean;
  dryRun: boolean;
  source: RollbackSource;
  /** The SQL that was executed (after outer transaction control was stripped). */
  sql: string;
  /** Whether the state row was removed so the migration can be re-applied. */
  stateRowDeleted: boolean;
}

// -------------------------------------------------------------------
// Security helpers
// -------------------------------------------------------------------

/** Valid migration tag pattern: 4-digit prefix + underscore + descriptive name. */
const VALID_TAG_PATTERN = /^\d{4}_\w+$/;

/**
 * Validate a migration tag to prevent injection via crafted filenames.
 * Tags must match the drizzle convention: `NNNN_descriptive_name`.
 */
export function validateMigrationTag(tag: string): boolean {
  return VALID_TAG_PATTERN.test(tag);
}

/**
 * Ensure a resolved file path is inside the migrations directory.
 * Prevents path traversal attacks like `../../etc/passwd`.
 */
function validateFilePath(filePath: string, migrationsDir: string): void {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(migrationsDir);
  if (!resolved.startsWith(resolvedDir + path.sep) && resolved !== resolvedDir) {
    throw new Error(`Path traversal detected: "${filePath}" is outside migrations directory`);
  }
}

/**
 * Block SQL patterns that could cause catastrophic damage.
 * This is a defense-in-depth measure — not a substitute for proper access controls.
 */
const DANGEROUS_SQL_PATTERNS = [
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER\s+SYSTEM\b/i,
  /\bpg_ctl\b/i,
  /\bCOPY\b.*\bFROM\b.*\bPROGRAM\b/i,
  /\blo_import\b/i,
  /\blo_export\b/i,
  /\bpg_read_file\b/i,
  /\bpg_write_file\b/i,
  /\bpg_sleep\b/i,
  /\bdbe_exec_sql\b/i,
];

export function containsDangerousSql(sql: string): boolean {
  // Strip dollar-quoted blocks (PL/pgSQL bodies) before checking
  const stripped = sql.replace(/\$[^$]*\$/g, '');
  return DANGEROUS_SQL_PATTERNS.some(pattern => pattern.test(stripped));
}

// -------------------------------------------------------------------
// Filesystem helpers
// -------------------------------------------------------------------

function resolveMigrationsDir(migrationsDir?: string): string {
  return path.resolve(migrationsDir ?? path.join(process.cwd(), DEFAULT_MIGRATIONS_DIR));
}

/**
 * Read `meta/_journal.json`. Returns an empty list when the journal is missing
 * or malformed rather than throwing, so coverage reporting still works.
 */
export function readJournal(migrationsDir?: string): JournalEntry[] {
  const journalPath = path.join(resolveMigrationsDir(migrationsDir), 'meta', '_journal.json');
  try {
    const raw = fs.readFileSync(journalPath, 'utf-8');
    const parsed = JSON.parse(raw) as { entries?: JournalEntry[] };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return [...entries].sort((a, b) => a.idx - b.idx);
  } catch (err) {
    logger.error('[rollback] Failed to read migration journal', {
      journalPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Extract the SQL between `-- DOWN` and `-- END DOWN` markers.
 * Returns null when the markers are absent or the section is empty.
 *
 * Note: `-- DOWN Migration` (a header comment used in several migrations) is
 * deliberately NOT treated as the opening marker — only a bare `-- DOWN` line
 * is, which is what `scripts/migration-runner.ts` also looked for.
 */
export function extractInlineDownSection(sql: string): string | null {
  const start = DOWN_START_MARKER.exec(sql);
  if (!start) return null;

  const afterStart = sql.slice(start.index + start[0].length);
  const end = DOWN_END_MARKER.exec(afterStart);
  const body = end ? afterStart.slice(0, end.index) : afterStart;
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A standalone top-level `BEGIN;` / `START TRANSACTION;` / `COMMIT;` statement. */
const TX_CONTROL_LINE = /^[ \t]*(?:BEGIN(?:[ \t]+TRANSACTION)?|START[ \t]+TRANSACTION|COMMIT(?:[ \t]+TRANSACTION)?)[ \t]*;[ \t]*$/i;
/** Dollar-quote delimiter, e.g. `$$` or `$func$`. */
const DOLLAR_QUOTE = /\$[A-Za-z_]*\$/g;

/**
 * Remove top-level transaction control statements from rollback SQL.
 *
 * Most rollback scripts wrap themselves in `BEGIN; ... COMMIT;`. Since
 * {@link rollbackMigration} already runs inside a transaction, leaving those in
 * would make the rollback commit itself early — which would silently defeat
 * `dryRun` and the "roll back on failure" guarantee.
 *
 * Only statements outside dollar-quoted blocks are removed, so `BEGIN` / `END;`
 * inside `DO $$ ... $$` PL/pgSQL bodies are left untouched.
 */
export function stripTransactionControl(sql: string): string {
  let insideDollarQuote = false;
  const kept: string[] = [];

  for (const line of sql.split('\n')) {
    if (!insideDollarQuote && TX_CONTROL_LINE.test(line)) {
      continue;
    }
    const delimiters = line.match(DOLLAR_QUOTE);
    if (delimiters && delimiters.length % 2 === 1) {
      insideDollarQuote = !insideDollarQuote;
    }
    kept.push(line);
  }

  return kept.join('\n').trim();
}

/**
 * Resolve rollback SQL for a migration tag, supporting both conventions.
 * A separate `<tag>.down.sql` file wins over an inline `-- DOWN` section.
 *
 * Security: validates the migration tag pattern and ensures file paths
 * stay within the migrations directory to prevent path traversal.
 */
export function resolveRollback(
  migrationTag: string,
  migrationsDir?: string
): ResolvedRollback | null {
  const dir = resolveMigrationsDir(migrationsDir);
  const tag = migrationTag.replace(/\.(down\.)?sql$/i, '');

  // Validate tag format to prevent injection via crafted filenames
  if (!validateMigrationTag(tag)) {
    logger.warn('[rollback] Invalid migration tag format, skipping', { tag });
    return null;
  }

  // Convention 1: sibling <tag>.down.sql file (preferred).
  const downPath = path.join(dir, `${tag}.down.sql`);
  validateFilePath(downPath, dir);
  if (fs.existsSync(downPath)) {
    const sql = fs.readFileSync(downPath, 'utf-8').trim();
    if (sql.length > 0) {
      return { tag, sql, source: 'down-file', file: downPath };
    }
  }

  // Convention 2: inline -- DOWN ... -- END DOWN section in <tag>.sql.
  const upPath = path.join(dir, `${tag}.sql`);
  validateFilePath(upPath, dir);
  if (fs.existsSync(upPath)) {
    const inline = extractInlineDownSection(fs.readFileSync(upPath, 'utf-8'));
    if (inline) {
      return { tag, sql: inline, source: 'inline', file: upPath };
    }
  }

  return null;
}

/**
 * Resolve the rollback SQL for a migration tag.
 * Returns null when neither convention provides rollback SQL.
 */
export async function parseRollbackSql(
  migrationTag: string,
  migrationsDir?: string
): Promise<string | null> {
  const resolved = resolveRollback(migrationTag, migrationsDir);
  return resolved ? resolved.sql : null;
}

// -------------------------------------------------------------------
// Applied migration state
// -------------------------------------------------------------------

interface MigrationStateRow {
  id: number | string;
  hash: string;
  created_at: number | string | null;
}

function toDate(value: number | string | null): Date | null {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * List migrations recorded in `drizzle.__drizzle_migrations`, newest first,
 * correlated with `meta/_journal.json` so each row has a human-readable tag.
 *
 * drizzle stores a content hash in `hash`, while the recovery path in
 * `scripts/migrate.ts` stores the tag itself. Both are handled, with a
 * positional fallback (drizzle applies migrations in journal order).
 */
export async function listAppliedMigrations(
  migrationsDir?: string
): Promise<AppliedMigration[]> {
  const journal = readJournal(migrationsDir);
  const byTag = new Map(journal.map((e) => [e.tag, e]));
  const byWhen = new Map(journal.map((e) => [e.when, e]));

  const pool = getPool();
  const result = await pool.query<MigrationStateRow>(
    `SELECT id, hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at ASC, id ASC`
  );
  const rows = result.rows ?? [];

  const applied: AppliedMigration[] = rows.map((row, position) => {
    const createdAt = toDate(row.created_at);
    const entry =
      byTag.get(row.hash) ??
      (row.created_at !== null ? byWhen.get(Number(row.created_at)) : undefined) ??
      journal[position];

    const tag = entry?.tag ?? `unknown:${String(row.hash).slice(0, 12)}`;
    return {
      tag,
      idx: entry?.idx ?? -1,
      hash: row.hash,
      appliedAt: createdAt,
      hasRollback: resolveRollback(tag, migrationsDir) !== null,
      id: typeof row.id === 'number' ? row.id : Number(row.id),
    };
  });

  // Newest first.
  return applied.reverse();
}

// -------------------------------------------------------------------
// Coverage report
// -------------------------------------------------------------------

/**
 * Report which migrations have rollback SQL and which do not, so the gap left
 * by issue #640 is measurable rather than anecdotal.
 */
export function verifyRollbackCoverage(migrationsDir?: string): RollbackCoverage {
  const journal = readJournal(migrationsDir);

  const entries: RollbackCoverageEntry[] = journal.map((e) => {
    const resolved = resolveRollback(e.tag, migrationsDir);
    return {
      tag: e.tag,
      idx: e.idx,
      hasRollback: resolved !== null,
      source: resolved?.source ?? null,
    };
  });

  const withRollback = entries.filter((e) => e.hasRollback).map((e) => e.tag);
  const withoutRollback = entries.filter((e) => !e.hasRollback).map((e) => e.tag);
  const total = entries.length;
  const covered = withRollback.length;

  return {
    total,
    covered,
    missing: withoutRollback.length,
    coveragePercent: total === 0 ? 0 : Math.round((covered / total) * 1000) / 10,
    entries,
    withRollback,
    withoutRollback,
  };
}

// -------------------------------------------------------------------
// Rollback execution
// -------------------------------------------------------------------

/**
 * Roll back a single migration.
 *
 * - Acquires the shared migration advisory lock so a rollback can never race a
 *   forward migration.
 * - Runs the rollback SQL inside a transaction.
 * - Deletes the migration's row from `drizzle.__drizzle_migrations` so the
 *   migration can be applied again.
 * - Refuses out-of-order rollbacks unless `force` is set, because reversing a
 *   migration that later migrations were built on top of corrupts schema state.
 * - With `dryRun`, everything runs but the transaction is rolled back.
 */
export async function rollbackMigration(
  migrationTag: string,
  opts: RollbackOptions = {}
): Promise<RollbackResult> {
  const { dryRun = false, force = false, migrationsDir, lockOptions } = opts;

  const applied = await listAppliedMigrations(migrationsDir);
  if (applied.length === 0) {
    throw new Error('No applied migrations found — nothing to roll back.');
  }

  const target = applied.find((m) => m.tag === migrationTag);
  if (!target) {
    throw new Error(
      `Migration "${migrationTag}" is not recorded as applied. ` +
        `Most recent applied migration is "${applied[0]!.tag}".`
    );
  }

  const latest = applied[0]!;
  if (target.tag !== latest.tag && !force) {
    throw new Error(
      `Refusing to roll back "${target.tag}" out of order: "${latest.tag}" was applied more recently. ` +
        `Rolling back out of order corrupts schema state. Pass force to override.`
    );
  }

  const resolved = resolveRollback(target.tag, migrationsDir);
  if (!resolved) {
    throw new Error(
      `No rollback SQL found for "${target.tag}". ` +
        `Add a "${target.tag}.down.sql" file or a "-- DOWN" / "-- END DOWN" section in "${target.tag}.sql".`
    );
  }

  const executableSql = stripTransactionControl(resolved.sql);

  // Block dangerous SQL patterns to prevent catastrophic damage
  if (containsDangerousSql(executableSql)) {
    throw new Error(
      `Rollback SQL for "${target.tag}" contains dangerous operations (DROP DATABASE, TRUNCATE, etc.). ` +
        `Review the file manually before executing.`
    );
  }

  if (dryRun) {
    logger.info('[rollback] Dry run — SQL that would be executed', {
      tag: target.tag,
      source: resolved.source,
      file: resolved.file,
    });
  }

  return withMigrationLock(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      if (executableSql.length > 0) {
        await client.query(executableSql);
      }
      await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE id = $1`, [target.id]);

      if (dryRun) {
        await client.query('ROLLBACK');
        return {
          tag: target.tag,
          committed: false,
          dryRun: true,
          source: resolved.source,
          sql: executableSql,
          stateRowDeleted: false,
        };
      }

      await client.query('COMMIT');
      logger.info('[rollback] Migration rolled back', {
        tag: target.tag,
        source: resolved.source,
      });
      return {
        tag: target.tag,
        committed: true,
        dryRun: false,
        source: resolved.source,
        sql: executableSql,
        stateRowDeleted: true,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* transaction may already be aborted */
      }
      logger.error('[rollback] Rollback failed, transaction reverted', {
        tag: target.tag,
        source: resolved.source,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }, lockOptions ?? {});
}
