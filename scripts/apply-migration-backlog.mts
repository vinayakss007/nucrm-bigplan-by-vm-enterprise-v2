#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2537 — one-command owner path for the live migration backlog.
 *
 * This automates the runbook steps that were previously manual: re-measure the
 * live ledger, take a verified dump BEFORE touching the schema, apply with the
 * production runner, re-measure, and print a record to paste into
 * docs/runbooks/go-live.md. Every stage fails closed; a non-zero exit means the
 * app was NOT migrated and the owner must read the last status line.
 *
 * Deliberately NOT part of deploy.yml: the apply is a maintenance-window
 * operation and #2537 is blocked on #2299 (the deploy hop). This is the
 * explicit, gated command an owner runs on the deploy host.
 *
 * Usage:
 *   DATABASE_URL=<live app url> BACKUP_DATABASE_URL=<bypass role> \
 *     npm run db:apply-backlog -- --yes
 *   npm run db:apply-backlog -- --dry-run   # measure + classify only
 *
 * Safety: --yes is mandatory for a real apply; the backup directory must be
 * durable (isEphemeralRestoreDir); a destructive pending set needs a verified
 * bypass dump role; the dump must exist and be non-empty before db:migrate runs.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveBackupDir } from '../lib/backups/paths';
import { runPgDump } from '../lib/backups/backup-service';
import { classifyPendingMigrations, isEphemeralRestoreDir } from '../lib/db/deploy-migration-run';
import { listAppliedMigrations, readJournal } from '../lib/db/rollback';

const REPO_ROOT = join(import.meta.dirname!, '..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'drizzle', 'migrations');

/** Parse the `Pending:` line from `npm run db:status`. Pure, for unit tests. */
export function parsePendingCount(output: string): number | null {
  const m = output.match(/^\s*Pending:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

/** One paste-ready line for the go-live runbook. */
export function formatRunbookRecord(iso: string, before: number, applied: string[]): string {
  return (
    `- #2537 backlog applied ${iso.slice(0, 10)}: ${before} pending → 0; ` +
    `${applied.length} migration(s) applied (${applied.join(', ') || 'none'}); ` +
    `verified with npm run db:status.`
  );
}

function die(msg: string): never {
  console.error(`[apply-backlog] ${msg}`);
  process.exit(1);
}

function run(args: string[], label: string): string {
  console.log(`[apply-backlog] ${label}...`);
  return execFileSync('npm', args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function pendingTags(): Promise<string[]> {
  const tags = readJournal(MIGRATIONS_DIR).map((e) => e.tag);
  let appliedRows: { tag: string }[] = [];
  try {
    appliedRows = await listAppliedMigrations(MIGRATIONS_DIR);
  } catch (err) {
    // A database nobody has migrated has no ledger table yet. db:status has
    // already read the same catalog and reported the pending count, so this is
    // the known fresh shape, not an unreadable snapshot — treat it as 0 applied.
    if ((err as { code?: string }).code !== '42P01') throw err;
  }
  const applied = new Set(appliedRows.map((m) => m.tag));
  return tags.filter((t) => !applied.has(t));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  if (!isDryRun && !args.includes('--yes')) {
    die('refusing to migrate the live database without --yes (or use --dry-run).');
  }
  if (!process.env.DATABASE_URL) die('DATABASE_URL is required (the live app connection string).');

  const beforeText = run(['run', 'db:status'], 'measuring the live ledger');
  const before = parsePendingCount(beforeText);
  if (before === null) die('could not read the Pending: count from db:status — see output above.');
  const tags = await pendingTags();
  console.log(`[apply-backlog] ${before} pending journal entr(ies): ${tags.join(', ') || 'none'}`);

  if (before === 0) {
    console.log('[apply-backlog] nothing to apply — database is current.');
    return;
  }
  if (tags.length === 0) {
    die('db:status says migrations are pending but the journal/ledger diff is empty — refusing to guess.');
  }

  const sqlByTag: Record<string, string | null> = {};
  for (const tag of tags) {
    // Reuse the same destructive classifier the deploy path uses. A missing
    // file counts as destructive (cannot prove safe ⇒ take the stronger dump).
    const p = join(MIGRATIONS_DIR, `${tag}.sql`);
    sqlByTag[tag] = existsSync(p) ? readFileSync(p, 'utf-8') : null;
  }
  const { destructive } = classifyPendingMigrations(sqlByTag);
  console.log(`[apply-backlog] destructive pending migration(s): ${destructive.join(', ') || 'none'}`);
  if (destructive.length > 0 && !process.env.BACKUP_DATABASE_URL) {
    die('destructive migrations pending — set BACKUP_DATABASE_URL to a role that can dump under FORCE RLS (PP-014).');
  }
  if (isDryRun) {
    console.log('[apply-backlog] DRY RUN — nothing backed up, applied or restarted.');
    return;
  }

  const restoreDir = resolveBackupDir();
  if (isEphemeralRestoreDir(restoreDir)) {
    die(`BACKUP_LOCAL_DIR="${restoreDir}" is ephemeral — a reboot would erase the restore point.`);
  }
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'pipe' });
  } catch {
    die('pg_dump is not on PATH — no restore point can be taken.');
  }
  if (!existsSync(restoreDir)) die(`backup directory does not exist: ${restoreDir}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = join(restoreDir, `pre-backlog-${stamp}.dump`);
  await runPgDump('full', dumpPath);
  if (!existsSync(dumpPath) || statSync(dumpPath).size === 0) {
    die(`dump at ${dumpPath} is missing or empty — refusing to migrate without a restore point.`);
  }
  console.log(`[apply-backlog] verified restore point: ${dumpPath}`);

  run(['run', 'db:migrate', '--', '--yes'], 'applying the backlog');
  const afterText = run(['run', 'db:status'], 're-measuring the live ledger');
  const after = parsePendingCount(afterText);
  if (after !== 0) {
    die(`db:status still reports ${String(after)} pending — investigate before declaring success.`);
  }
  console.log(`[apply-backlog] ${formatRunbookRecord(new Date().toISOString(), before, tags)}`);
  console.log(`[apply-backlog] restore point (do not delete): ${dumpPath}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err: unknown) => {
    console.error('[apply-backlog] crashed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
