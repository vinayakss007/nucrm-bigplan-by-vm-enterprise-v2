#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Unified disaster-recovery / backup operator CLI.
 *
 * One entry point for the day-to-day and break-glass operations, so an operator
 * doesn't have to remember four separate scripts and their env combos. It is a
 * thin wrapper — the heavy lifting stays in the existing, tested scripts:
 *
 *   backup   → scripts/backup-db.ts     (pg_dump + off-site upload + retention)
 *   verify   → scripts/verify-backup.ts (restore into a scratch DB, prove it)
 *   restore  → scripts/restore-db.ts    (real recovery, with safety guards)
 *   list     → reads backup_records catalog (this file)
 *   status   → DR-readiness summary from backup_records (this file)
 *
 * Usage:
 *   npm run dr status
 *   npm run dr list [--limit 20]
 *   npm run dr backup
 *   npm run dr verify [--id <uuid>] [--checksum-only]
 *   npm run dr restore --latest --dry-run
 *   TARGET_DATABASE_URL=... npm run dr restore --id <uuid> --confirm
 *
 * Anything after the subcommand is passed straight through to the underlying
 * script, so all of restore-db.ts's flags (--id, --latest, --confirm,
 * --dry-run, --allow-nonempty, --allow-same-db) work unchanged.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { Pool } from 'pg';

const SCRIPTS_DIR = __dirname;

function delegate(script: string, passthroughArgs: string[]): number {
  const scriptPath = path.join(SCRIPTS_DIR, script);
  const res = spawnSync('npx', ['tsx', scriptPath, ...passthroughArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  return res.status ?? 1;
}

async function withCatalog<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }
  let ssl: false | { rejectUnauthorized: boolean } = false;
  try {
    ssl = (await import('../lib/db/ssl-config')).pgSslConfig();
  } catch { /* no override */ }
  const pool = new Pool({ connectionString: url, max: 1, ssl });
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

function fmtBytes(v: string | number | null): string {
  const n = typeof v === 'string' ? parseInt(v, 10) : v ?? 0;
  if (!n) return '—';
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fmtAge(d: Date | null): string {
  if (!d) return 'n/a';
  const ms = Date.now() - new Date(d).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m ago`;
  if (h < 48) return `${h.toFixed(1)}h ago`;
  return `${(h / 24).toFixed(1)}d ago`;
}

interface CatalogRow {
  id: string;
  backup_type: string;
  status: string;
  size_bytes: string | number | null;
  storage_type: string | null;
  completed_at: Date | null;
  verified_ok: boolean | null;
  last_verified_at: Date | null;
}

async function cmdList(args: string[]): Promise<number> {
  const limIdx = args.indexOf('--limit');
  const limit = limIdx !== -1 ? Math.max(1, Math.min(200, parseInt(args[limIdx + 1] ?? '20', 10) || 20)) : 20;

  return withCatalog(async (pool) => {
    const { rows } = await pool.query<CatalogRow>(
      `SELECT id, backup_type, status, size_bytes, storage_type,
              completed_at, verified_ok, last_verified_at
         FROM backup_records
        ORDER BY completed_at DESC NULLS LAST
        LIMIT $1`,
      [limit]
    );
    if (rows.length === 0) {
      console.log('No backup records found.');
      return 0;
    }
    console.log(`\nMost recent ${rows.length} backup(s):\n`);
    console.log('  ' + ['ID', 'TYPE', 'STATUS', 'SIZE', 'WHEN', 'VERIFIED'].join('\t'));
    for (const r of rows) {
      const verified = r.verified_ok === true ? 'ok' : r.verified_ok === false ? 'FAILED' : '—';
      console.log(
        '  ' +
          [
            r.id.slice(0, 8),
            r.backup_type,
            r.status,
            fmtBytes(r.size_bytes),
            fmtAge(r.completed_at),
            verified,
          ].join('\t')
      );
    }
    console.log('');
    return 0;
  });
}

async function cmdStatus(): Promise<number> {
  return withCatalog(async (pool) => {
    const { rows } = await pool.query<CatalogRow>(
      `SELECT id, backup_type, status, size_bytes, storage_type,
              completed_at, verified_ok, last_verified_at
         FROM backup_records
        WHERE status = 'completed'
        ORDER BY completed_at DESC NULLS LAST
        LIMIT 1`
    );
    const latest = rows[0];

    // Off-site storage readiness.
    let storageState = 'unknown';
    try {
      const { getS3Config } = await import('../lib/storage/s3-config');
      const cfg = getS3Config();
      const bucket = cfg.backupBucket || (cfg as { bucket?: string }).bucket;
      storageState = cfg.configured && bucket ? `off-site (${bucket})` : 'HOST-ONLY (not durable)';
    } catch { /* leave unknown */ }

    console.log('\nDR readiness');
    console.log('='.repeat(40));
    if (!latest) {
      console.log('  latest backup     : NONE — no completed backup exists');
      console.log(`  off-site storage  : ${storageState}`);
      console.log('\n  VERDICT: NOT RECOVERABLE — run `npm run dr backup` now.\n');
      return 1;
    }

    const ageH = latest.completed_at
      ? (Date.now() - new Date(latest.completed_at).getTime()) / 3_600_000
      : Infinity;
    const stale = ageH > 25;
    const verified = latest.verified_ok === true;

    console.log(`  latest backup     : ${latest.id.slice(0, 8)} (${latest.backup_type}, ${fmtBytes(latest.size_bytes)})`);
    console.log(`  age               : ${fmtAge(latest.completed_at)}${stale ? '  ⚠ STALE (>25h)' : ''}`);
    console.log(`  verified          : ${verified ? 'yes' : latest.verified_ok === false ? 'NO — last verify FAILED' : 'never verified'}`);
    console.log(`  last verified     : ${fmtAge(latest.last_verified_at)}`);
    console.log(`  off-site storage  : ${storageState}`);

    const problems: string[] = [];
    if (stale) problems.push('backup is stale');
    if (!verified) problems.push('backup not proven restorable');
    if (storageState.startsWith('HOST-ONLY')) problems.push('no off-site copy');

    if (problems.length === 0) {
      console.log('\n  VERDICT: HEALTHY — recent, verified, off-site.\n');
      return 0;
    }
    console.log(`\n  VERDICT: AT RISK — ${problems.join('; ')}.\n`);
    return 1;
  });
}

function usage(): void {
  console.log(`
NuCRM DR / backup operator CLI

  npm run dr status                 DR-readiness summary (age, verified, off-site)
  npm run dr list [--limit N]       list recent backup records
  npm run dr backup                 create a backup now (→ backup-db.ts)
  npm run dr verify [--id <uuid>]   prove a backup restores (→ verify-backup.ts)
  npm run dr restore <flags>        recover a backup (→ restore-db.ts)

Restore examples:
  npm run dr restore --latest --dry-run
  TARGET_DATABASE_URL=postgres://... npm run dr restore --id <uuid> --confirm
`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'backup':
      process.exit(delegate('backup-db.ts', rest));
      break;
    case 'verify':
      process.exit(delegate('verify-backup.ts', rest));
      break;
    case 'restore':
      process.exit(delegate('restore-db.ts', rest));
      break;
    case 'list':
      process.exit(await cmdList(rest));
      break;
    case 'status':
      process.exit(await cmdStatus());
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      usage();
      process.exit(cmd === undefined ? 1 : 0);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('dr cli error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
