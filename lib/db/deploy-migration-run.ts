/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Deploy-time migration orchestration (#2233 follow-up).
 *
 * PR #2376 closed #2233 by writing ~70 lines of bash into the deploy workflow's
 * SSH heredoc: it scraped `rollback-migration.ts --list` stdout with `awk`,
 * parsed `.env.local` with an inline `node -e` regex, dumped a schema-only
 * restore point into `/tmp`, pruned it with `ls -t | tail -n +11 | xargs rm`,
 * and un-applied migrations on failure even though
 * `.kiro/steering/global-standards.md` §6.3 says migrations are forward-only.
 * Every one of those decisions now lives here, expressed against the primitives
 * the repo already had (`lib/db/rollback.ts`, `lib/db/migration-safety.ts`) so it
 * is type-checked and unit-tested instead of being shell text nobody can run
 * without SSHing into a production host.
 *
 * Three rules this module exists to enforce:
 *
 *  1. **Fail closed on a blind snapshot.** If the applied-migration list cannot be
 *     read, that is not "nothing is applied" — it is "we cannot tell", and
 *     migrating anyway is how #2376 could compute the wrong rollback set.
 *  2. **Forward-only (§6.3).** A failed migration aborts the deploy with the
 *     schema left as-is, and prints the exact restore point plus the exact
 *     `db:rollback` command for the tags that actually have rollback SQL. The
 *     deploy never reverses DDL by itself.
 *  3. **Never delete a backup or restore point.** See
 *     `lib/backups/retention-policy.ts`: local copies are never auto-deleted and
 *     offsite expiry honours the 2-year floor. This module writes restore points
 *     and has no code path that unlinks anything.
 */

import { containsDangerousSql, validateMigrationTag } from '@/lib/db/rollback';

// -------------------------------------------------------------------
// Classification
// -------------------------------------------------------------------

/**
 * DDL that removes data or makes the previous release's queries fail. The
 * schema-only restore point cannot help with these — reversing a dropped column
 * needs the data, not the DDL — so they additionally require a real dump.
 */
const DESTRUCTIVE_DDL_PATTERNS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\b/i,
];

/** SQL stripped of comments and dollar-quoted bodies, for pattern matching. */
export function sqlForClassification(sql: string): string {
  return sql
    .replace(/\$[^$]*\$/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*--[^\n]*$/gm, '');
}

export interface PendingClassification {
  destructive: string[];
  additive: string[];
}

/**
 * Split pending migration tags into those that destroy data and those that do
 * not. Unknown/missing SQL counts as destructive: not being able to prove a
 * migration is safe is a reason to take the stronger backup, not to skip it.
 */
export function classifyPendingMigrations(
  sqlByTag: Record<string, string | null>,
): PendingClassification {
  const destructive: string[] = [];
  const additive: string[] = [];

  for (const [tag, sql] of Object.entries(sqlByTag)) {
    if (sql === null || sql === undefined) {
      destructive.push(tag);
      continue;
    }
    const body = sqlForClassification(sql);
    const isDestructive =
      DESTRUCTIVE_DDL_PATTERNS.some((re) => re.test(body)) || containsDangerousSql(body);
    (isDestructive ? destructive : additive).push(tag);
  }

  return { destructive, additive };
}

/**
 * A restore point under an ephemeral path is no restore point at all: this host
 * is documented (AGENTS.md) to have lost the app to a reboot before.
 */
export function isEphemeralRestoreDir(dir: string): boolean {
  return dir === '/tmp' || dir.startsWith('/tmp/') || dir.startsWith('/var/tmp');
}

/** Tags applied by `post` that were not in `pre`, in journal order. */
export function diffAppliedTags(pre: ReadonlySet<string>, post: Iterable<string>): string[] {
  const out: string[] = [];
  for (const tag of post) if (!pre.has(tag)) out.push(tag);
  return out;
}

// -------------------------------------------------------------------
// Ports (everything with a side effect is injected, so the logic is testable)
// -------------------------------------------------------------------

export interface RestorePointResult {
  /** Absolute path of the dump. Absent when it failed. */
  path?: string;
  error?: string;
}

export interface DeployMigrateDeps {
  /** Journal tags in apply order (`readJournal()`). */
  journalTags(): string[];
  /** Applied tags from the ledger table (`listAppliedMigrations()`). */
  listAppliedTags(): Promise<string[]>;
  /** SQL for a pending tag, or null when the file is missing. */
  readMigrationSql(tag: string): string | null;
  /** Connectivity + advisory-lock availability. */
  preflight(): Promise<{ ok: boolean; errors: string[] }>;
  /** Run `fn` while holding the migration advisory lock. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  /** `pg_dump --schema-only`. Must not delete anything. */
  writeSchemaRestorePoint(): Promise<RestorePointResult>;
  /** Full dump via the existing backup path. Must not delete anything. */
  writeDataBackup(): Promise<RestorePointResult>;
  /** Apply pending migrations (`scripts/migrate.ts --yes`). */
  runMigrations(): Promise<{ ok: boolean; error?: string }>;
  log?(msg: string): void;
}

export type DeployMigrateStatus =
  | 'no-pending'
  | 'applied'
  | 'aborted-journal'
  | 'aborted-snapshot'
  | 'aborted-preflight'
  | 'aborted-no-restore-point'
  | 'aborted-no-data-backup'
  | 'failed-forward-only';

export interface DeployMigrateResult {
  status: DeployMigrateStatus;
  pendingTags: string[];
  /** What this run actually added — empty for every abort status. */
  appliedTags: string[];
  destructiveTags: string[];
  restorePoint: string | null;
  dataBackup: string | null;
  errors: string[];
  /**
   * Ready-to-run rollback commands, only ever printed — this process never
   * executes them (§6.3). Filtered to tags that resolve rollback SQL so an
   * operator is never told to roll back something that cannot be rolled back.
   */
  rollbackCommands: string[];
}

// -------------------------------------------------------------------
// Orchestration
// -------------------------------------------------------------------

const OK = (status: DeployMigrateStatus, base: Omit<DeployMigrateResult, 'status'>): DeployMigrateResult => ({
  ...base,
  status,
});

/**
 * Migrate the schema ahead of a deploy: snapshot, protect, apply, report.
 *
 * The caller decides what to do with a non-`no-pending`/`applied` result — the
 * deploy workflow aborts before building or restarting anything.
 */
export async function runDeployMigrations(
  deps: DeployMigrateDeps,
  opts: { rollbackResolver?: (tag: string) => boolean } = {},
): Promise<DeployMigrateResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const base: Omit<DeployMigrateResult, 'status'> = {
    pendingTags: [],
    appliedTags: [],
    destructiveTags: [],
    restorePoint: null,
    dataBackup: null,
    errors: [],
    rollbackCommands: [],
  };

  // ── 1. Journal integrity ────────────────────────────────────────────
  const journal = deps.journalTags();
  const malformed = journal.filter((t) => !validateMigrationTag(t));
  if (malformed.length > 0) {
    return OK('aborted-journal', {
      ...base,
      errors: [`journal contains ${malformed.length} malformed tag(s): ${malformed.join(', ')}`],
    });
  }

  // ── 2. Snapshot the ledger (fail closed, never assume "empty") ───────
  let appliedBefore: string[];
  try {
    appliedBefore = await deps.listAppliedTags();
  } catch (err) {
    return OK('aborted-snapshot', {
      ...base,
      errors: [`could not read applied migrations: ${errMsg(err)}`],
    });
  }

  const appliedSet = new Set(appliedBefore);
  const pendingTags = journal.filter((t) => !appliedSet.has(t));

  // An empty ledger against a populated journal is either a fresh database or a
  // failed read, and the two are not distinguishable from here. migrate.ts owns
  // the fresh-install path, so refuse to second-guess it during a deploy.
  if (appliedBefore.length === 0 && journal.length > 0) {
    return OK('aborted-snapshot', {
      ...base,
      pendingTags,
      errors: [
        `ledger reports 0 applied migrations but the journal has ${journal.length} — ` +
          `refusing to migrate against an unreadable snapshot (see #2262). ` +
          `If this database is genuinely fresh, run npm run db:migrate -- --yes by hand.`,
      ],
    });
  }

  if (pendingTags.length === 0) {
    // The common case, and deliberately zero work: no dump, no lock, no delete.
    return OK('no-pending', base);
  }

  // ── 3. Classify what we are about to do ─────────────────────────────
  const sqlByTag: Record<string, string | null> = {};
  for (const tag of pendingTags) sqlByTag[tag] = deps.readMigrationSql(tag);
  const { destructive } = classifyPendingMigrations(sqlByTag);
  const withSql = { ...base, pendingTags, destructiveTags: destructive };

  const missing = pendingTags.filter((t) => sqlByTag[t] === null);
  if (missing.length > 0) {
    return OK('aborted-journal', {
      ...withSql,
      errors: [`journal references ${missing.length} missing SQL file(s): ${missing.join(', ')}`],
    });
  }

  // ── 4. Preflight + lock ─────────────────────────────────────────────
  const pre = await deps.preflight();
  if (!pre.ok) {
    return OK('aborted-preflight', { ...withSql, errors: pre.errors });
  }

  return deps.withLock(async () => {
    // ── 5. Restore point, before anything is applied ──────────────────
    const schema = await deps.writeSchemaRestorePoint();
    if (!schema.path) {
      return OK('aborted-no-restore-point', {
        ...withSql,
        errors: [`schema restore point failed: ${schema.error ?? 'unknown error'}`],
      });
    }
    log(`[deploy-migrate] schema restore point: ${schema.path}`);

    let dataBackupPath: string | null = null;
    if (destructive.length > 0) {
      log(
        `[deploy-migrate] ${destructive.length} destructive migration(s) pending ` +
          `(${destructive.join(', ')}) — a schema-only dump cannot reverse those.`,
      );
      const data = await deps.writeDataBackup();
      if (!data.path) {
        return OK('aborted-no-data-backup', {
          ...withSql,
          restorePoint: schema.path,
          errors: [
            `destructive migrations need a full data backup, and it failed: ` +
              `${data.error ?? 'unknown error'}. Set BACKUP_DATABASE_URL to a role that can ` +
              `pg_dump under FORCE RLS (PP-014), then re-run the deploy.`,
          ],
        });
      }
      dataBackupPath = data.path;
      log(`[deploy-migrate] data backup: ${data.path}`);
    }

    // ── 6. Apply ──────────────────────────────────────────────────────
    const ran = await deps.runMigrations();
    const restoreInfo = { ...withSql, restorePoint: schema.path, dataBackup: dataBackupPath };

    if (!ran.ok) {
      // Forward-only (§6.3): never reverse DDL from the deploy path. Hand the
      // operator the exact, verified commands instead.
      const reversible = pendingTags.filter(
        (t) => opts.rollbackResolver?.(t) ?? true,
      );
      return OK('failed-forward-only', {
        ...restoreInfo,
        errors: [`db:migrate failed: ${ran.error ?? 'see output above'}`],
        rollbackCommands: reversible.map(
          (t) => `npm run db:rollback -- ${t} --yes`,
        ),
      });
    }

    // ── 7. Report what actually landed ────────────────────────────────
    let appliedNow: string[] = [];
    try {
      appliedNow = diffAppliedTags(new Set(appliedBefore), await deps.listAppliedTags());
    } catch (err) {
      // The migrations DID apply; a failed re-read must not fail the deploy.
      log(`[deploy-migrate] WARNING: post-apply snapshot unreadable: ${errMsg(err)}`);
    }

    log(`[deploy-migrate] applied ${appliedNow.length} migration(s) by this deploy`);
    return OK('applied', { ...restoreInfo, appliedTags: appliedNow });
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
