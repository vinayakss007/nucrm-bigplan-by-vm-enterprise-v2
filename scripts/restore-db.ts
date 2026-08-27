#!/usr/bin/env npx tsx
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Disaster-recovery restore.
 *
 * `backup:verify` proves a backup is intact and *restorable* by loading it into
 * a throwaway scratch database. This script is the other half: it restores a
 * chosen backup into a REAL target database during an actual recovery.
 *
 * It locates the artefact (local or S3), verifies its recorded checksum,
 * decrypts it if it is an AES-256-GCM `.enc` file, and runs pg_restore/psql
 * against the target. Because this is destructive, it refuses to run without an
 * explicit confirmation.
 *
 * Usage:
 *   # Restore the latest completed backup into a fresh/empty target DB:
 *   TARGET_DATABASE_URL=postgres://user:pass@host:5432/nucrm_restore \
 *     npx tsx scripts/restore-db.ts --latest --confirm
 *
 *   # Restore a specific backup:
 *   TARGET_DATABASE_URL=... npx tsx scripts/restore-db.ts --id <uuid> --confirm
 *
 *   # Dry run (locate + checksum + decrypt, but do not touch the target):
 *   TARGET_DATABASE_URL=... npx tsx scripts/restore-db.ts --latest --dry-run
 *
 * Flags:
 *   --id <uuid>     Restore a specific backup_records row (default: latest completed).
 *   --latest        Explicitly select the latest completed backup.
 *   --confirm       Required to actually write to the target database.
 *   --dry-run       Locate/verify/decrypt only; never writes to the target.
 *   --allow-nonempty  Permit restoring into a target that already has tables.
 *
 * Environment:
 *   DATABASE_URL          Source of the backup_records catalog (the live app DB).
 *   TARGET_DATABASE_URL   Where to restore. MUST differ from DATABASE_URL unless
 *                         --allow-same-db is passed (guards against clobbering prod).
 *   BACKUP_ENCRYPTION_KEY Needed only if the artefact is encrypted (.enc).
 *
 * Exits non-zero on any failure so it can be wired into a recovery runbook.
 */

import { Pool } from 'pg';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync, statSync, createReadStream } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createHash } from 'crypto';

interface BackupRow {
  id: string;
  backup_type: string;
  storage_path: string | null;
  storage_type: string | null;
  size_bytes: string | number | null;
  checksum: string | null;
  completed_at: Date | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const hasFlag = (name: string) => process.argv.includes(name);

function checksumFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 2000)}`))));
  });
}

const MAX_RESTORE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB safety limit for the download path

/** Download an S3/R2-stored backup to a local temp path (mirrors verify-backup.ts). */
async function fetchFromS3(storagePath: string, destDir: string): Promise<string> {
  const { getS3Config } = await import('../lib/storage/s3-config');
  const cfg = getS3Config();
  if (!cfg.configured || !cfg.backupBucket) {
    throw new Error('Backup is stored off-site but S3 is not configured locally');
  }
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: cfg.credentials });
  const res = await client.send(new GetObjectCommand({ Bucket: cfg.backupBucket, Key: storagePath }));
  if (!res.Body) throw new Error(`Empty body for s3://${cfg.backupBucket}/${storagePath}`);

  const stream = res.Body as import('stream').Readable;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MAX_RESTORE_SIZE_BYTES) {
      throw new Error(`Backup exceeded ${MAX_RESTORE_SIZE_BYTES / 1024 / 1024} MB download limit`);
    }
    chunks.push(Buffer.from(chunk));
  }
  const dest = path.join(destDir, path.basename(storagePath));
  const { writeFile } = await import('fs/promises');
  await writeFile(dest, Buffer.concat(chunks));
  return dest;
}

async function main() {
  const catalogUrl = process.env.DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  const dryRun = hasFlag('--dry-run');
  const confirmed = hasFlag('--confirm');

  if (!catalogUrl) { console.error('ERROR: DATABASE_URL (backup catalog) is required'); process.exit(1); }
  if (!targetUrl) { console.error('ERROR: TARGET_DATABASE_URL (restore destination) is required'); process.exit(1); }

  // Guard: never restore over the catalog/prod DB unless explicitly allowed.
  if (targetUrl === catalogUrl && !hasFlag('--allow-same-db')) {
    console.error(
      'ERROR: TARGET_DATABASE_URL equals DATABASE_URL. Refusing to restore over the ' +
      'live/catalog database. Pass --allow-same-db only if you truly intend this.'
    );
    process.exit(1);
  }
  if (!dryRun && !confirmed) {
    console.error('ERROR: this writes to the target database. Re-run with --confirm (or use --dry-run).');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: catalogUrl, max: 1 });
  let workDir: string | null = null;
  const t0 = Date.now();

  try {
    const id = arg('--id');
    const { rows } = id
      ? await pool.query<BackupRow>(
          `SELECT id, backup_type, storage_path, storage_type, size_bytes, checksum, completed_at
             FROM backup_records WHERE id = $1`, [id])
      : await pool.query<BackupRow>(
          `SELECT id, backup_type, storage_path, storage_type, size_bytes, checksum, completed_at
             FROM backup_records WHERE status = 'completed'
            ORDER BY completed_at DESC NULLS LAST LIMIT 1`);

    const backup = rows[0];
    if (!backup) { console.error('ERROR: no matching completed backup found'); process.exit(1); }
    if (!backup.storage_path) { console.error('ERROR: backup record has no storage_path — artefact unlocatable'); process.exit(1); }

    console.log(`\nRestoring backup ${backup.id}`);
    console.log(`  type      : ${backup.backup_type}`);
    console.log(`  storage   : ${backup.storage_type} ${backup.storage_path}`);
    console.log(`  completed : ${backup.completed_at?.toISOString() ?? 'n/a'}`);
    console.log(`  target    : ${new URL(targetUrl).pathname.slice(1)} @ ${new URL(targetUrl).host}`);

    workDir = mkdtempSync(path.join(tmpdir(), 'nucrm-restore-'));

    // ── Locate the artefact ────────────────────────────────────────────────
    let localFile: string;
    if (backup.storage_type === 'local') {
      if (!existsSync(backup.storage_path)) {
        console.error(`ERROR: local-only backup missing from disk at ${backup.storage_path}`);
        process.exit(1);
      }
      localFile = backup.storage_path;
    } else {
      console.log('  fetching from object storage...');
      localFile = await fetchFromS3(backup.storage_path, workDir);
    }

    // ── Verify checksum (fail closed if it doesn't match) ───────────────────
    if (backup.checksum) {
      const actual = await checksumFile(localFile);
      if (actual.toLowerCase() !== backup.checksum.toLowerCase()) {
        console.error(`ERROR: checksum mismatch (recorded ${backup.checksum}, actual ${actual}). Artefact corrupt.`);
        process.exit(1);
      }
      console.log(`  ok checksum: ${actual}`);
    } else {
      console.warn('  ! checksum NOT RECORDED for this backup — integrity cannot be proven');
    }

    // ── Decrypt if the artefact is encrypted (.enc) ─────────────────────────
    let restoreFile = localFile;
    if (localFile.endsWith('.enc')) {
      const { decryptBackupFile } = await import('../lib/backups/encrypt');
      const decryptedPath = path.join(workDir, path.basename(localFile).replace(/\.enc$/, ''));
      console.log('  decrypting artefact (AES-256-GCM)...');
      await decryptBackupFile(localFile, decryptedPath);
      restoreFile = decryptedPath;
    }

    const sizeMb = (statSync(restoreFile).size / 1024 / 1024).toFixed(1);
    console.log(`  artefact ready: ${restoreFile} (${sizeMb} MB)`);

    if (dryRun) {
      console.log('\nDRY RUN — artefact located, verified and decrypted. Target not touched.\n');
      return;
    }

    // ── Pre-flight: refuse to clobber a non-empty target unless allowed ─────
    const targetPool = new Pool({ connectionString: targetUrl, max: 1 });
    try {
      const { rows: tRows } = await targetPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
      const existingTables = parseInt(tRows[0]?.count ?? '0', 10);
      if (existingTables > 0 && !hasFlag('--allow-nonempty')) {
        console.error(
          `ERROR: target already has ${existingTables} table(s). Restore into a fresh/empty ` +
          `database, or pass --allow-nonempty if you intend to restore on top of it.`);
        process.exit(1);
      }
    } finally {
      await targetPool.end();
    }

    // ── Restore ─────────────────────────────────────────────────────────────
    console.log('  restoring into target...');
    const restoreStart = Date.now();
    if (backup.backup_type === 'selective') {
      await run('psql', [targetUrl, '-v', 'ON_ERROR_STOP=1', '-f', restoreFile]);
    } else {
      await run('pg_restore', ['--no-owner', '--no-acl', '-d', targetUrl, restoreFile]);
    }
    const restoreMs = Date.now() - restoreStart;

    // ── Validate the result ──────────────────────────────────────────────────
    const verifyPool = new Pool({ connectionString: targetUrl, max: 1 });
    try {
      const tables = await verifyPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
      const tableCount = parseInt(tables.rows[0]?.count ?? '0', 10);
      console.log(`  ok restore : ${tableCount} table(s) in ${(restoreMs / 1000).toFixed(1)}s`);
      if (tableCount === 0) { console.error('ERROR: restored database has zero tables'); process.exit(1); }

      if (backup.backup_type !== 'schema') {
        const users = await verifyPool.query<{ count: string }>(`SELECT count(*)::text AS count FROM users`).catch(() => null);
        if (!users) { console.error('ERROR: restored database has no readable users table'); process.exit(1); }
        console.log(`  ok data    : users rows = ${users.rows[0]?.count ?? '0'}`);
      }
    } finally {
      await verifyPool.end();
    }

    const totalS = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nPASS — restore complete (RTO ~${totalS}s end-to-end).`);
    console.log('Next: point the app at the restored DB and run `npm run db:verify-integrity` and `npm run db:verify-isolation`.\n');
  } catch (err) {
    console.error(`\nFAIL — restore did not complete: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    await pool.end();
  }
}

main();
