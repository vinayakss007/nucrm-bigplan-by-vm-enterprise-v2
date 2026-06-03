#!/usr/bin/env node
/**
 * Database Backup Script
 * Run: npx tsx scripts/backup-db.ts
 * 
 * Cron: 0 2 * * * (Daily at 2 AM)
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BUCKET = process.env['S3_BUCKET'] || 'nucrm-backups';
const KEEP_DAYS = process.env['BACKUP_KEEP_DAYS'] || '30';

async function createBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `nucrm-backup-${timestamp}.sql`;
  const tempPath = join('/tmp', filename);

  console.log(`[Backup] Starting backup: ${filename}`);

  // Create pg_dump
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not set');
  }

  // Run pg_dump
  console.log('[Backup] Creating PostgreSQL dump...');
  execSync(`pg_dump "${databaseUrl}" > ${tempPath}`, { stdio: 'inherit' });

  // Read backup file
  const backupData = existsSync(tempPath) 
    ? readFileSync(tempPath)
    : Buffer.from('');

  const fileSize = (backupData.length / 1024 / 1024).toFixed(2);
  console.log(`[Backup] Backup created: ${fileSize} MB`);

  // Upload to S3
  if (process.env['S3_ENDPOINT']) {
    console.log('[Backup] Uploading to S3...');
    const { uploadBackup, deleteOldBackups } = await import('../lib/storage/s3');
    
    await uploadBackup(backupData, filename);
    console.log(`[Backup] Uploaded: s3://${BUCKET}/backups/${filename}`);
    
    // Cleanup old backups
    await deleteOldBackups(parseInt(KEEP_DAYS));
    console.log(`[Backup] Cleanup complete, keeping last ${KEEP_DAYS} backups`);
  }

  // Cleanup temp file
  unlinkSync(tempPath);
  
  console.log('[Backup] Complete!');
}

createBackup().catch(err => {
  console.error('[Backup] Failed:', err);
  process.exit(1);
});
