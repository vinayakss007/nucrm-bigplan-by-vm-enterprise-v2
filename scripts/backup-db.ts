#!/usr/bin/env node
/**
 * Database Backup Script
 * Run: npx tsx scripts/backup-db.ts
 *
 * Creates a full PostgreSQL dump with timestamped filename,
 * stores it locally, optionally uploads to S3/R2, and
 * enforces 30-day retention for old local backup files.
 *
 * Cron: 0 2 * * * (Daily at 2 AM)
 *
 * Env vars:
 *   DATABASE_URL         – required, PostgreSQL connection string
 *   BACKUP_LOCAL_DIR     – local backup directory (default: /tmp/nucrm-backups)
 *   BACKUP_KEEP_DAYS     – retention period in days (default: 30)
 *   S3_ENDPOINT          – S3-compatible endpoint (optional)
 *   S3_BUCKET            – bucket name (default: nucrm-backups)
 *   S3_ACCESS_KEY_ID     – S3 access key
 *   S3_SECRET_ACCESS_KEY – S3 secret key
 */

import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

const KEEP_DAYS = parseInt(process.env['BACKUP_KEEP_DAYS'] || '30', 10);
const LOCAL_DIR = process.env['BACKUP_LOCAL_DIR'] || '/tmp/nucrm-backups';
const S3_BUCKET = process.env['S3_BUCKET'] || 'nucrm-backups';

async function createBackup(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nucrm-backup-${timestamp}.sql`;
  const localPath = join(LOCAL_DIR, filename);

  const databaseUrl = process.env['DATABASE_URL'];
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
  execSync(`pg_dump "${databaseUrl}" > ${localPath}`, { stdio: 'inherit' });

  if (!existsSync(localPath)) {
    throw new Error('pg_dump did not produce output file');
  }

  const fileSize = (statSync(localPath).size / 1024 / 1024).toFixed(2);
  console.log(`[Backup] Created: ${filename} (${fileSize} MB)`);

  // Upload to S3/R2 if endpoint is configured
  if (process.env['S3_ENDPOINT']) {
    try {
      console.log('[Backup] Uploading to S3...');
      const { uploadBackup, deleteOldBackups } = await import(
        '../lib/storage/s3'
      );

      const backupData = readFileSync(localPath);
      await uploadBackup(backupData, filename);
      console.log(`[Backup] Uploaded: s3://${S3_BUCKET}/backups/${filename}`);

      // Cleanup old S3 backups (keep last KEEP_DAYS objects by count)
      await deleteOldBackups(KEEP_DAYS);
      console.log(`[Backup] S3 cleanup done, keeping last ${KEEP_DAYS}`);
    } catch (err: any) {
      console.error('[Backup] S3 upload failed:', err.message);
    }
  }

  // ── Local retention: delete files older than KEEP_DAYS ──────────────
  console.log(`[Backup] Enforcing ${KEEP_DAYS}-day local retention...`);
  const cutoffMs = Date.now() - KEEP_DAYS * 86_400_000;
  const entries = readdirSync(LOCAL_DIR);
  let removed = 0;

  for (const entry of entries) {
    if (!entry.startsWith('nucrm-backup-')) continue;
    const fullPath = join(LOCAL_DIR, entry);
    try {
      const stats = statSync(fullPath);
      if (stats.mtimeMs < cutoffMs) {
        unlinkSync(fullPath);
        removed++;
      }
    } catch {
      // skip files that vanish between readdir and stat
    }
  }

  if (removed > 0) {
    console.log(`[Backup] Removed ${removed} old backup(s) from ${LOCAL_DIR}`);
  }

  console.log('[Backup] Complete!');
}

createBackup().catch((err) => {
  console.error('[Backup] Failed:', err);
  process.exit(1);
});
