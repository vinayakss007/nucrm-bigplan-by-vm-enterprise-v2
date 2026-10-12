#!/usr/bin/env node
/**
 * Database Backup Script
 * Run: npx tsx scripts/backup-db.ts
 *
 * Creates a full PostgreSQL dump with timestamped filename,
 * stores it locally, optionally uploads to S3/R2.
 *
 * Cron: 0 2 * * * (Daily at 2 AM)
 *
 * RETENTION (#2233 follow-up): this script NEVER deletes anything. Local copies
 * are kept forever — pruning the local disk is a human decision, not a nightly
 * side effect — and the offsite copy is expired only by the scheduled tiered
 * purge, which refuses to touch anything younger than MIN_RETENTION_DAYS (2
 * years). It used to unlink local files older than BACKUP_KEEP_DAYS (30) and
 * trim the bucket to the newest KEEP_DAYS objects by COUNT, so a burst of
 * same-day dumps could delete the only restore point minutes after writing it.
 *
 * Env vars:
 *   DATABASE_URL         – required, PostgreSQL connection string
 *   BACKUP_LOCAL_DIR     – local backup directory (default: /tmp/nucrm-backups;
 *                          set this somewhere durable — /tmp is wiped on reboot)
 *   S3_ENDPOINT          – S3-compatible endpoint (optional)
 *   S3_BUCKET            – bucket name (default: nucrm-backups)
 *   S3_ACCESS_KEY_ID     – S3 access key
 *   S3_SECRET_ACCESS_KEY – S3 secret key
 */

import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { join } from 'path';

const LOCAL_DIR = process.env['BACKUP_LOCAL_DIR'] || '/tmp/nucrm-backups';
const S3_BUCKET = process.env['S3_BUCKET'] || 'nucrm-backups';

async function createBackup(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nucrm-backup-${timestamp}.sql`;
  const localPath = join(LOCAL_DIR, filename);

  // PP-014/PP-015: pg_dump runs SET row_security=off, which PostgreSQL only
  // honours for superuser/BYPASSRLS roles while every tenant table is FORCE
  // ROW LEVEL SECURITY — so the app role can never produce a complete dump.
  // BACKUP_DATABASE_URL aims the dump at a bypass role; it is consumed by
  // backup scripts only, never by the application.
  const databaseUrl = process.env['BACKUP_DATABASE_URL'] || process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set');
  }

  // Ensure local backup directory exists
  if (!existsSync(LOCAL_DIR)) {
    mkdirSync(LOCAL_DIR, { recursive: true });
  }

  console.log(`[Backup] Starting: ${filename}`);

  // Run pg_dump
  console.log('[Backup] Creating PostgreSQL dump...');
  // #1247: never pass the full connection string as an argv element (visible in `ps`);
  // split into flags and pass the password via PGPASSWORD env instead.
  const parsed = new URL(databaseUrl);
  const dbHost = parsed.hostname;
  const dbPort = parsed.port || '5432';
  const dbUser = decodeURIComponent(parsed.username);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  const dbPassword = decodeURIComponent(parsed.password);
  if (!dbName) {
    throw new Error('DATABASE_URL must include a database name');
  }
  execFileSync(
    'pg_dump',
    ['-h', dbHost, '-p', dbPort, '-U', dbUser, '-d', dbName, '-f', localPath],
    { stdio: 'inherit', env: { ...process.env, PGPASSWORD: dbPassword } }
  );

  if (!existsSync(localPath)) {
    throw new Error('pg_dump did not produce output file');
  }

  const fileSize = (statSync(localPath).size / 1024 / 1024).toFixed(2);
  console.log(`[Backup] Created: ${filename} (${fileSize} MB)`);

  // Upload to S3/R2 if endpoint is configured
  if (process.env['S3_ENDPOINT']) {
    try {
      console.log('[Backup] Uploading to S3...');
      const { uploadBackup } = await import(
        '../lib/storage/s3'
      );

      const backupData = readFileSync(localPath);
      await uploadBackup(backupData, filename);
      console.log(`[Backup] Uploaded: s3://${S3_BUCKET}/backups/${filename}`);

      // No bucket pruning here (#2233 follow-up): expiry is the scheduled
      // tiered purge's job, and it enforces the 2-year floor. Trimming by
      // count on every dump is what could remove a still-needed restore point.
    } catch (err: unknown) {
      console.error('[Backup] S3 upload failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Local retention: none. Nothing here is ever deleted (#2233 follow-up) ──
  const kept = readdirSync(LOCAL_DIR).filter((f) => f.startsWith('nucrm-backup-')).length;
  console.log(
    `[Backup] Local copies are never auto-deleted; ${kept} file(s) in ${LOCAL_DIR}.` +
      (LOCAL_DIR.startsWith('/tmp')
        ? ' WARNING: BACKUP_LOCAL_DIR is under /tmp and will be wiped by a reboot.'
        : ''),
  );

  console.log('[Backup] Complete!');
}

createBackup().catch((err) => {
  console.error('[Backup] Failed:', err);
  process.exit(1);
});
