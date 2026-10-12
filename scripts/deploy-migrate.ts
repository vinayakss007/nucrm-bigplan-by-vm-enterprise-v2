#!/usr/bin/env npx tsx
/**
 * Deploy-time migration entry point (#2233 follow-up).
 *
 * All decisions live in `lib/db/deploy-migration-run.ts` (type-checked,
 * unit-tested); this file is only the adapters, because `scripts/**` is
 * excluded from `tsconfig.json`.
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.mjs scripts/deploy-migrate.ts --yes
 *   npm run db:deploy-migrate -- --dry-run
 *
 * Exit codes: 0 = nothing pending, or applied cleanly. 1 = anything else,
 * including every `aborted-*` state — the deploy workflow must not build or
 * restart on a non-zero exit.
 *
 * Env:
 *   DATABASE_URL                       – required (loaded via load-env.mjs, never
 *                                        re-parsed out of .env.local here)
 *   BACKUP_DATABASE_URL                – bypass role, required for destructive
 *                                        migration sets (PP-014)
 *   BACKUP_LOCAL_DIR                   – where restore points go. Must NOT be
 *                                        under /tmp unless
 *                                        DEPLOY_ALLOW_EPHEMERAL_RESTORE_POINT=1:
 *                                        a reboot wipes /tmp, and the restore
 *                                        point exists precisely for the bad day.
 *   DEPLOY_ALLOW_EPHEMERAL_RESTORE_POINT – opt out of the /tmp refusal
 */

import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { preflightChecks, withMigrationLock } from '../lib/db/migration-safety';
import {
  isEphemeralRestoreDir,
  runDeployMigrations,
  type DeployMigrateDeps,
  type DeployMigrateResult,
  type RestorePointResult,
} from '../lib/db/deploy-migration-run';
import { listAppliedMigrations, readJournal, resolveRollback } from '../lib/db/rollback';

const REPO_ROOT = join(import.meta.dirname!, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'drizzle', 'migrations');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const allowEphemeral = process.env.DEPLOY_ALLOW_EPHEMERAL_RESTORE_POINT === '1';

const RESTORE_DIR = process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups';

function die(msg: string): never {
  console.error(`[deploy-migrate] ${msg}`);
  process.exit(1);
}

/** Flatten an error — including AggregateError's `.errors` — into one line. */
function describeErr(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.name, err.message].filter(Boolean).join(': ');
  const agg = (err as Error & { errors?: unknown[] }).errors;
  if (Array.isArray(agg) && agg.length > 0) {
    return `${parts} [${agg.map((e) => describeErr(e)).join(' | ')}]`;
  }
  return parts || String(err);
}

/** `pg_dump --schema-only` is `--format=custom`, so it is restored with pg_restore. */
function restoreHint(path: string): string {
  return `pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" ${path}`;
}

async function writeDump(kind: 'schema' | 'full'): Promise<RestorePointResult> {
  const { runPgDump } = await import('../lib/backups/backup-service');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sha = process.env.DEPLOY_SHA?.slice(0, 8) ?? 'local';
  const outputPath = join(RESTORE_DIR, `deploy-${kind}-pre-${sha}-${stamp}.dump`);

  try {
    if (!existsSync(RESTORE_DIR)) mkdirSync(RESTORE_DIR, { recursive: true });
    await runPgDump(kind, outputPath);
    if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
      return { error: `${kind} dump produced an empty file` };
    }
    const mb = (statSync(outputPath).size / 1024 / 1024).toFixed(2);
    console.log(`[deploy-migrate] ${kind} dump ${mb} MB — restore with:\n  ${restoreHint(outputPath)}`);
    return { path: outputPath };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function runMigrations(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', '--import', './scripts/load-env.mjs', 'scripts/migrate.ts', '--yes'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
    child.on('close', (code) =>
      resolve(code === 0 ? { ok: true } : { ok: false, error: `migrate.ts exited ${String(code)}` }),
    );
  });
}

function summary(r: DeployMigrateResult): string {
  const lines = [
    `[deploy-migrate] status=${r.status}`,
    `  pending:    ${r.pendingTags.length ? r.pendingTags.join(', ') : 'none'}`,
    `  applied:    ${r.appliedTags.length ? r.appliedTags.join(', ') : 'none'}`,
    `  destructive:${r.destructiveTags.length ? r.destructiveTags.join(', ') : 'none'}`,
    `  schema restore point: ${r.restorePoint ?? 'none'}`,
    `  data backup:          ${r.dataBackup ?? 'none (not required)'}`,
  ];
  if (r.errors.length > 0) lines.push(`  errors: ${r.errors.join(' | ')}`);
  if (r.rollbackCommands.length > 0) {
    lines.push(
      '  migrations are FORWARD-ONLY (§6.3) — nothing was reversed automatically.',
      '  To undo deliberately, run (newest first):',
      ...r.rollbackCommands.map((c) => `    ${c}`),
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    die(
      'DATABASE_URL is not set. This script expects it from the environment ' +
        '(run it as `npx tsx --import ./scripts/load-env.mjs scripts/deploy-migrate.ts`).',
    );
  }
  if (!args.includes('--yes') && !isDryRun) {
    die('refusing to migrate a deploy target without --yes.');
  }
  if (!isDryRun && isEphemeralRestoreDir(RESTORE_DIR) && !allowEphemeral) {
    die(
      `BACKUP_LOCAL_DIR="${RESTORE_DIR}" is ephemeral. A restore point that a reboot ` +
        `erases is not a restore point. Point BACKUP_LOCAL_DIR at durable storage, or set ` +
        `DEPLOY_ALLOW_EPHEMERAL_RESTORE_POINT=1 if you really mean it.`,
    );
  }

  // pg_dump must exist before any real run: no dump means no restore point.
  // A --dry-run takes neither, so it is not gated on the client being installed.
  if (!isDryRun) {
    try {
      execFileSync('pg_dump', ['--version'], { stdio: 'pipe' });
    } catch {
      die(
        'pg_dump is not on PATH, so no restore point can be taken. Install postgresql-client ' +
          'on the deploy host (or run this inside a container that has it).',
      );
    }
  }

  const journalTags = readJournal(MIGRATIONS_DIR).map((e) => e.tag);

  if (isDryRun) {
    let applied;
    try {
      applied = await listAppliedMigrations(MIGRATIONS_DIR);
    } catch (err) {
      // AggregateError (ECONNREFUSED) carries an empty .message and puts the
      // useful part ("connect ECONNREFUSED 127.0.0.1:5432") in .errors, so
      // name-and-join rather than printing "could not read the ledger: ".
      die(`--dry-run could not read the ledger: ${describeErr(err)}`);
    }
    const appliedSet = new Set(applied.map((m) => m.tag));
    const pending = journalTags.filter((t) => !appliedSet.has(t));
    console.log(
      `[deploy-migrate] DRY RUN — ${pending.length} pending of ${journalTags.length} journal ` +
        `entries, ${applied.length} recorded as applied. Nothing was backed up or applied.`,
    );
    for (const t of pending) console.log(`  would apply: ${t}`);
    process.exit(0);
  }

  const deps: DeployMigrateDeps = {
    journalTags: () => journalTags,
    listAppliedTags: async () => (await listAppliedMigrations(MIGRATIONS_DIR)).map((m) => m.tag),
    readMigrationSql: (tag) => {
      const p = join(MIGRATIONS_DIR, `${tag}.sql`);
      return existsSync(p) ? readFileSync(p, 'utf-8') : null;
    },
    preflight: async () => {
      const r = await preflightChecks();
      return { ok: r.errors.length === 0 && r.databaseReachable, errors: r.errors };
    },
    withLock: (fn) => withMigrationLock(async () => fn()),
    writeSchemaRestorePoint: () => writeDump('schema'),
    writeDataBackup: () => writeDump('full'),
    runMigrations,
  };

  const result = await runDeployMigrations(deps, {
    rollbackResolver: (tag) => resolveRollback(tag, MIGRATIONS_DIR) !== null,
  });

  console.log(summary(result));
  process.exit(result.status === 'no-pending' || result.status === 'applied' ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('[deploy-migrate] crashed:', describeErr(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
