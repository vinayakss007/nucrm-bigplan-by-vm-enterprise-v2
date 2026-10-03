/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Pure helpers for the fresh-replay branch of `scripts/migrate.ts`
 * (issues #2254 and #2235).
 *
 * Why this exists as a separate, side-effect-free module:
 *   #2254 — the fresh-replay path used to apply every journal file but NEVER
 *           stamp `drizzle.__drizzle_migrations`, so the ledger stayed empty
 *           and every subsequent `db:migrate` replayed ~2,919 statements
 *           (including destructive DROP TABLE / DELETE / UPDATE) over live
 *           data. `planMigrations()` / `ledgerRowFor()` make the replay
 *           ledger-stamped and idempotent: already-stamped files are skipped,
 *           each replayed file is stamped immediately after it succeeds.
 *   #2235 — replay used to swallow failing statements (42703 / 42P01 / 42P11
 *           were counted "skipped" while the run exited 0) and strip
 *           `CONCURRENTLY`. `shouldAbort()` fails loud on everything outside
 *           a tiny explicit "already exists" allowlist, and
 *           `partitionStatements()` runs CREATE INDEX CONCURRENTLY *outside*
 *           the per-file transaction instead of mangling the statement.
 *
 * All functions here are testable with a fake runner — no database needed.
 */
import { createHash } from 'node:crypto';

/** A `meta/_journal.json` entry (only the fields we rely on). */
export interface JournalEntryLike {
  tag: string;
  /** epoch ms the file was generated; used as the ledger `created_at` */
  when?: number;
  idx?: number;
}

/** One row of `drizzle.__drizzle_migrations`. */
export interface LedgerRowLike {
  hash: string;
  createdAt: number | null;
}

/** Minimal surface of a pg Client/Pool we need (fake-friendly). */
export interface SqlClient {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

/**
 * Explicit "already exists" allowlist (#2254 fix #2 / #2235 fix). ONLY these
 * two SQLSTATEs may be tolerated, and only when the server message actually
 * says "already exists" (see `shouldAbort`). Everything else aborts the run:
 *   42P07  duplicate_table   — CREATE TABLE of an object an earlier file made
 *   42710  duplicate_object  — CREATE POLICY/TRIGGER/INDEX/CONSTRAINT dupes
 * The old set also carried 42703 (undefined_column), 42P01 (undefined_table)
 * and 42P11 (undefined_object) — those silently skipped security-relevant
 * UPDATE/DELETE/policy statements and produced false-green runs, so they are
 * deliberately GONE.
 */
export const ALREADY_EXISTS_CODES: ReadonlySet<string> = new Set(['42P07', '42710']);

/**
 * Second, *conditional* allowlist — exactly the exception #2235's fix text
 * calls for: "fail non-zero on tolerated 42703 unless a true zero-tables
 * fresh-DB check passes".
 *
 * The journal has documented file-order quirks (0004's `CREATE TABLE IF NOT
 * EXISTS webhook_queue` is a no-op because 0002 already created it WITHOUT
 * `tenant_id`, so 0004's `CREATE INDEX … (tenant_id)` raises 42703; 0046
 * then repairs the column and re-creates the index). On a TRUE zero-table
 * build there is no user data to clobber — the "does not exist" object is
 * simply absent — so these may be tolerated, and the repair file fixes it
 * later in the same run.
 *
 * On ANY other database (tables present = partial rerun / push-provisioned
 * drift) the same errors hide real breakage over live data, so they ABORT.
 * `runFreshReplay` only enables this set when the caller verified the public
 * schema was empty BEFORE the first statement of the run.
 */
export const ZERO_TABLE_FILE_ORDER_CODES: ReadonlySet<string> = new Set(['42703', '42P01', '42P11']);

/** sha256 hex of the raw file text — identical to drizzle-kit/drizzle-orm's
 *  `readMigrationFiles()` hash (`crypto.createHash('sha256').update(query)`). */
export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/* ────────────────────────────── SQL splitting ───────────────────────────── */

/**
 * Splits SQL into statements on semicolons while respecting dollar-quoted
 * blocks ($$…$$), named dollar tags ($tag$…$tag$), and single-quoted
 * string literals. Semicolons inside those contexts are never treated as
 * statement terminators. (Moved verbatim from scripts/migrate.ts.)
 */
export function splitSql(sql: string): string[] {
  const stmts: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    // Dollar-quoted block: $$ or $tag$
    if (sql[i] === '$') {
      const tagMatch = sql.slice(i).match(/^\$([^$]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        current += tag;
        i += tag.length;
        let closeIdx = sql.indexOf(tag, i);
        while (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
          closeIdx = sql.indexOf(tag, i);
        }
        continue;
      }
    }
    // Single-quoted string literal (handles escaped '' inside)
    if (sql[i] === "'") {
      current += sql[i]; i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''"; i += 2;
        } else if (sql[i] === "'") {
          current += "'"; i++; break;
        } else {
          current += sql[i]; i++;
        }
      }
      continue;
    }
    // Single-line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      if (nl === -1) { current += sql.slice(i); i = sql.length; }
      else { current += sql.slice(i, nl + 1); i = nl + 1; }
      continue;
    }
    // Block comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) { current += sql.slice(i); i = sql.length; }
      else { current += sql.slice(i, close + 2); i = close + 2; }
      continue;
    }
    // Semicolon = statement terminator
    if (sql[i] === ';') {
      current += ';';
      stmts.push(current);
      current = '';
      i++;
      while (i < sql.length && (sql[i] === '\n' || sql[i] === '\r' || sql[i] === ' ' || sql[i] === '\t')) i++;
      continue;
    }
    current += sql[i];
    i++;
  }
  if (current.trim()) stmts.push(current);
  return stmts;
}

/** Remove line (`--`) and block comments from a copy of the text; used only
 *  for classification — executed statements keep their comments. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** True for bare transaction-control statements (`BEGIN;`, `COMMIT;`, …).
 *  #2235: files 0034-0045 embed BEGIN/COMMIT which break the runner-owned
 *  transaction; the runner owns tx control, so these are dropped. */
export function isTxControlStatement(stmt: string): boolean {
  const bare = stripSqlComments(stmt).replace(/;\s*$/, '').trim();
  return /^(BEGIN(\s+TRANSACTION)?|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT)$/i.test(bare);
}

/** True when the statement is index DDL carrying CONCURRENTLY (CREATE / DROP /
 *  REINDEX … CONCURRENTLY). Such statements must NOT run inside a transaction. */
export function isConcurrentIndexStatement(stmt: string): boolean {
  const bare = stripSqlComments(stmt);
  return /^(CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX|REINDEX)\b/i.test(bare.trim())
    && /\bCONCURRENTLY\b/i.test(bare);
}

/** A run chunk: a group of statements safe to share one transaction, or a
 *  single statement that must execute outside any transaction. */
export type StatementChunk =
  | { type: 'tx'; statements: string[] }
  | { type: 'nontransactional'; statement: string };

/** Preserve CONCURRENTLY (#2235 fix #2): instead of stripping the keyword,
 *  split the statement list so CONCURRENTLY DDL runs outside a transaction
 *  and everything else stays grouped in per-chunk transactions. */
export function partitionStatements(statements: string[]): StatementChunk[] {
  const chunks: StatementChunk[] = [];
  let txBuf: string[] = [];
  const flush = () => {
    if (txBuf.length) { chunks.push({ type: 'tx', statements: txBuf }); txBuf = []; }
  };
  for (const stmt of statements) {
    if (isConcurrentIndexStatement(stmt)) {
      flush();
      chunks.push({ type: 'nontransactional', statement: stmt });
    } else {
      txBuf.push(stmt);
    }
  }
  flush();
  return chunks;
}

/**
 * Turn migration-file content into the exact statement list the fresh-replay
 * runner will execute: DOWN section stripped, statement-breakpoints honored,
 * dollar-quote-aware splitting, embedded transaction-control statements
 * dropped. CONCURRENTLY is preserved (never stripped).
 */
export function extractStatements(content: string): string[] {
  let text = content;
  // Strip DOWN section — some hand-written migrations include rollback
  // statements after a "-- DOWN" marker; we only apply the UP portion.
  const downIdx = text.search(/^--\s*DOWN\s*$/m);
  if (downIdx !== -1) text = text.slice(0, downIdx);

  const hasBreakpoints = text.includes('--> statement-breakpoint');
  const segments = hasBreakpoints
    ? text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)
    : [text];

  const out: string[] = [];
  for (const segment of segments) {
    for (const stmt of splitSql(segment)) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      if (isTxControlStatement(trimmed)) continue;
      // Comment-only statements are no-ops; don't bother executing them.
      if (!stripSqlComments(trimmed).trim()) continue;
      out.push(trimmed);
    }
  }
  return out;
}

/* ────────────────────────────── error policy ────────────────────────────── */

/**
 * Decide whether a statement error must ABORT the fresh replay (#2235 fix #1:
 * fail loud, no more false-green "skipped" counters).
 *
 * - Always tolerated: `ALREADY_EXISTS_CODES` (42P07/42710) whose message
 *   actually says "already exists".
 * - Tolerated ONLY when `zeroTableFreshBuild` is true (public schema had 0
 *   tables before the run started): `ZERO_TABLE_FILE_ORDER_CODES` whose
 *   message says the object "does not exist" — the documented 0002/0004/0046
 *   file-order quirk class, harmless with no data present.
 * - EVERYTHING else aborts.
 *
 * The 2nd arg also accepts a bare Set (legacy = the already-exists
 * allowlist) for convenience in tests.
 */
export interface ShouldAbortOptions {
  allowlist?: ReadonlySet<string>;
  zeroTableFreshBuild?: boolean;
}

export function shouldAbort(err: unknown, opts?: ReadonlySet<string> | ShouldAbortOptions): boolean {
  const options: ShouldAbortOptions = opts instanceof Set
    ? { allowlist: opts }
    : (opts as ShouldAbortOptions | undefined) ?? {};
  const allowlist = options.allowlist ?? ALREADY_EXISTS_CODES;
  const code = (err as { code?: string } | null | undefined)?.code;
  if (!code) return true;
  const message = ((err as { message?: string } | null | undefined)?.message ?? '').toLowerCase();
  if (allowlist.has(code) && message.includes('already exists')) return false;
  if (options.zeroTableFreshBuild && ZERO_TABLE_FILE_ORDER_CODES.has(code)
    && /(does not exist|no such|undefined)/.test(message)) return false;
  return true;
}

/** Format one failure the way migrate.ts reports them. */
export function formatStatementError(fileName: string, err: unknown, stmt: string): string {
  const pgErr = err as { code?: string; message?: string };
  return `[${fileName}] ${pgErr.code || 'UNKNOWN'}: ${pgErr.message?.split('\n')[0] || stmt.slice(0, 120)}`;
}

/* ─────────────────────────── ledger stamping / plan ─────────────────────── */

/** The row a journal entry stamps into `drizzle.__drizzle_migrations`. */
export interface LedgerStampRow {
  tag: string;
  /** sha256 hex of the file bytes — same value drizzle-orm's readMigrationFiles() computes */
  hash: string;
  /** journal entry `when` (ms); falls back to file mtime, then wall clock */
  createdAt: number;
}

/** Compute the ledger row for one journal entry. `fileMtimeMs` is only used
 *  when the journal entry lacks `when` (drizzle always writes `when`, but
 *  hand-edited journals exist). */
export function ledgerRowFor(
  entry: JournalEntryLike,
  content: string | Buffer,
  fileMtimeMs?: number | null,
  now: number = Date.now(),
): LedgerStampRow {
  const hash = sha256Hex(content);
  const createdAt = typeof entry.when === 'number' && Number.isFinite(entry.when)
    ? entry.when
    : Math.round(fileMtimeMs ?? now);
  return { tag: entry.tag, hash, createdAt };
}

export type PlannedAction = 'replay' | 'skip-stamped' | 'missing-file';

export interface PlannedFile {
  tag: string;
  /** created_at the stamp would use */
  createdAt: number;
  /** sha256 of the file, or null when the file is missing on disk */
  hash: string | null;
  action: PlannedAction;
  reason: string;
}

/**
 * Decide, per journal entry, whether it is already stamped in the ledger
 * (match on `created_at` OR `hash`) or still needs fresh replay. Idempotent:
 * running this on a post-replay ledger yields only `skip-stamped`.
 */
export function planMigrations(
  entries: JournalEntryLike[],
  ledgerRows: LedgerRowLike[],
  readFile: (tag: string) => string | null,
  statMtime?: (tag: string) => number | null,
  now: number = Date.now(),
): PlannedFile[] {
  const ledgerCreatedAts = new Set(
    ledgerRows.map((r) => (r.createdAt === null ? null : Number(r.createdAt))).filter((v) => v !== null),
  );
  const ledgerHashes = new Set(ledgerRows.map((r) => r.hash));

  return entries.map((entry) => {
    const content = readFile(entry.tag);
    if (content === null) {
      const createdAt = typeof entry.when === 'number'
        ? entry.when
        : Math.round(statMtime?.(entry.tag) ?? now);
      return {
        tag: entry.tag,
        createdAt,
        hash: null,
        action: 'missing-file',
        reason: `journal lists ${entry.tag}.sql but the file is not on disk`,
      };
    }
    const row = ledgerRowFor(entry, content, statMtime?.(entry.tag) ?? null, now);
    if (ledgerHashes.has(row.hash)) {
      return { tag: entry.tag, createdAt: row.createdAt, hash: row.hash, action: 'skip-stamped', reason: 'hash present in ledger' };
    }
    if (ledgerCreatedAts.has(row.createdAt)) {
      return { tag: entry.tag, createdAt: row.createdAt, hash: row.hash, action: 'skip-stamped', reason: 'created_at (journal when) present in ledger' };
    }
    return { tag: entry.tag, createdAt: row.createdAt, hash: row.hash, action: 'replay', reason: 'not stamped' };
  });
}

/**
 * Build the idempotent INSERT that stamps one ledger row. Uses
 * `INSERT … SELECT … WHERE NOT EXISTS` (rather than ON CONFLICT, since the
 * stock drizzle table has no unique constraint). The guard keys on
 * `created_at` ONLY — deliberately not on hash, because the journal contains
 * files with identical content (empty no-op files): two entries can share a
 * sha256 while having distinct `when` values, and drizzle decides what is
 * outstanding purely from `max(created_at)` vs each entry's `folderMillis`.
 * A hash-based suppression would drop the second entry's created_at and make
 * the next run replay from there. `fkUpdatesColumn` is the data_type of the
 * optional `fk_updates` column that newer drizzle-kit versions add — include
 * it (=0 / =false) only when it exists.
 */
export function buildLedgerInsert(
  row: Pick<LedgerStampRow, 'hash' | 'createdAt'>,
  fkUpdatesColumn?: string | null,
): { text: string; params: unknown[] } {
  const cols = ['"hash"', '"created_at"', ...(fkUpdatesColumn ? ['"fk_updates"'] : [])];
  const vals = ['$1', '$2', ...(fkUpdatesColumn ? ['$3'] : [])];
  const params: unknown[] = [
    row.hash,
    row.createdAt,
    ...(fkUpdatesColumn ? [fkUpdatesColumn === 'boolean' ? false : 0] : []),
  ];
  const text = `INSERT INTO "drizzle"."__drizzle_migrations" (${cols.join(', ')})
SELECT ${vals.join(', ')}
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = $2
)`;
  return { text, params };
}

/* ─────────────────────────── replay execution ───────────────────────────── */

export interface FileRunStats {
  applied: number;
  skipped: number;
  /** "does not exist" skips tolerated ONLY on a true zero-table fresh build */
  skippedZeroTableQuirk: number;
  /** statements executed as CONCURRENTLY DDL outside transactions */
  concurrent: number;
  /** formatted error message when a statement aborted the file, else null */
  fatal: string | null;
}

/**
 * Execute one file's statements on `client`:
 *   - each `tx` chunk runs inside one BEGIN/COMMIT transaction with a
 *     per-statement SAVEPOINT, so a tolerated "already exists" error rolls
 *     back only that statement (the #2254 "3 DROP TABLEs replayed
 *     unconditionally, autocommit-per-statement" failure mode is gone: a file
 *     either fully applies or is rolled back);
 *   - `nontransactional` chunks (CONCURRENTLY DDL) run standalone, keyword
 *     preserved;
 *   - the FIRST error outside the tolerated sets makes the file fatal: the
 *     transaction is rolled back and no further chunks run.
 * `zeroTableFreshBuild` unlocks the narrow file-order allowance described on
 * `shouldAbort` — the caller must have verified the public schema was empty
 * before the run.
 */
export async function applyMigrationFile(
  client: SqlClient,
  fileName: string,
  statements: string[],
  opts?: { zeroTableFreshBuild?: boolean },
): Promise<FileRunStats> {
  const stats: FileRunStats = { applied: 0, skipped: 0, skippedZeroTableQuirk: 0, concurrent: 0, fatal: null };
  const abortOpts = { zeroTableFreshBuild: opts?.zeroTableFreshBuild === true };

  for (const chunk of partitionStatements(statements)) {
    if (chunk.type === 'nontransactional') {
      try {
        await client.query(chunk.statement);
        stats.applied++;
        stats.concurrent++;
      } catch (err) {
        if (shouldAbort(err, abortOpts)) {
          stats.fatal = formatStatementError(fileName, err, chunk.statement);
          return stats;
        }
        if (isZeroTableQuirkSkip(err, abortOpts)) stats.skippedZeroTableQuirk++;
        else stats.skipped++;
      }
      continue;
    }

    await client.query('BEGIN');
    let sp = 0;
    let txRolledBack = false;
    for (const stmt of chunk.statements) {
      sp++;
      try {
        await client.query(`SAVEPOINT sp_${sp}`);
        await client.query(stmt);
        stats.applied++;
      } catch (err) {
        try { await client.query(`ROLLBACK TO sp_${sp}`); } catch { /* keep going to the decision below */ }
        if (shouldAbort(err, abortOpts)) {
          try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
          txRolledBack = true;
          stats.fatal = formatStatementError(fileName, err, stmt);
          break;
        }
        if (isZeroTableQuirkSkip(err, abortOpts)) stats.skippedZeroTableQuirk++;
        else stats.skipped++;
      }
    }
    if (txRolledBack || stats.fatal) return stats;
    await client.query('COMMIT');
  }
  return stats;
}

/** True when the error was tolerated via the zero-table file-order allowance. */
function isZeroTableQuirkSkip(err: unknown, opts: { zeroTableFreshBuild: boolean }): boolean {
  if (!opts.zeroTableFreshBuild) return false;
  const code = (err as { code?: string } | null | undefined)?.code;
  return !!code && ZERO_TABLE_FILE_ORDER_CODES.has(code) && !ALREADY_EXISTS_CODES.has(code);
}

export interface FreshReplayStats {
  applied: number;
  skipped: number;
  skippedZeroTableQuirk: number;
  concurrent: number;
  /** tags of files stamped into the ledger during this run */
  stampedTags: string[];
  /** per-file ledger rows the run expected to stamp (replay targets) */
  replayTargets: number;
  /** formatted fatal errors; non-empty means the caller MUST exit non-zero */
  fatal: string[];
}

/**
 * Drive the fresh-replay branch over a plan: skip stamped files, execute each
 * replay file, stamp its ledger row immediately on success, and STOP at the
 * first fatal file (#2254 fix #2 / #2235 fix #1 — fail loud, never a
 * logs-and-continues green). `stamp` must persist the row idempotently.
 */
export async function runFreshReplay(opts: {
  client: SqlClient;
  plan: PlannedFile[];
  readFile: (tag: string) => string | null;
  stamp: (row: LedgerStampRow) => Promise<void>;
  log?: (line: string) => void;
  dryRun?: boolean;
  /** caller verified the public schema had ZERO tables before the run began;
   *  enables the narrow file-order allowance (see `shouldAbort`). */
  zeroTableFreshBuild?: boolean;
}): Promise<FreshReplayStats> {
  const { client, plan, readFile, stamp } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  const stats: FreshReplayStats = {
    applied: 0, skipped: 0, skippedZeroTableQuirk: 0, concurrent: 0, stampedTags: [], replayTargets: 0, fatal: [],
  };

  for (const file of plan) {
    if (file.action === 'missing-file') {
      // A journal entry without a file is a repo/journal inconsistency —
      // fail loud rather than silently continuing (which used to leave the
      // ledger half-stamped).
      stats.fatal.push(`[${file.tag}.sql] ${file.reason}`);
      log(`[migrate] FATAL: ${file.reason}`);
      return stats;
    }
    if (file.action === 'skip-stamped') {
      log(`[migrate] ${file.tag}.sql: already stamped in ledger (${file.reason}) — skipped`);
      continue;
    }
    stats.replayTargets++;
    if (opts.dryRun) {
      const content = readFile(file.tag);
      const n = content === null ? 0 : extractStatements(content).length;
      log(`[migrate] DRY ${file.tag}.sql: would replay ${n} statement(s), then stamp created_at=${file.createdAt}`);
      continue;
    }
    const content = readFile(file.tag)!;
    const statements = extractStatements(content);
    const fileStats = await applyMigrationFile(client, `${file.tag}.sql`, statements, {
      zeroTableFreshBuild: opts.zeroTableFreshBuild === true,
    });
    stats.applied += fileStats.applied;
    stats.skipped += fileStats.skipped;
    stats.skippedZeroTableQuirk += fileStats.skippedZeroTableQuirk;
    stats.concurrent += fileStats.concurrent;
    if (fileStats.fatal) {
      stats.fatal.push(fileStats.fatal);
      log(`[migrate] FATAL in ${file.tag}.sql — aborting; file NOT stamped, no later files executed.`);
      return stats;
    }
    // Stamp immediately, per file: a crash mid-run resumes (via the normal
    // drizzle path, which keys on max(created_at)) without replaying this
    // file's statements again over live data.
    await stamp({ tag: file.tag, hash: file.hash!, createdAt: file.createdAt });
    stats.stampedTags.push(file.tag);
    log(`[migrate] ${file.tag}.sql: ${fileStats.applied} applied, ${fileStats.skipped} skipped (already exists)`
      + (fileStats.skippedZeroTableQuirk > 0 ? `, ${fileStats.skippedZeroTableQuirk} file-order quirk(s) tolerated (zero-table build)` : '')
      + ', ledger stamped');
  }
  return stats;
}
