/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { acquireLock } from '@/lib/cache';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { backupRecords, backupAlerts, errorLogs } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { alertSuperAdmin } from '@/lib/email/service';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { ensureDir, deleteFile, getFileStats } from '@/lib/backups/runtime-fs';
import { logError } from '@/lib/errors-server';
import { checksumFile, CHECKSUM_ALGORITHM } from '@/lib/backups/integrity';
import { uploadBackupArtifact, purgeExpiredBackups, resolveRetentionDays } from '@/lib/backups/offsite';
import { isS3Configured, describeS3ConfigGap } from '@/lib/storage/s3-config';

const exec = promisify(execCb);

/**
 * Safely run pg_dump with input validation.
 * All parameters are validated against allowlists to prevent command injection.
 * 
 * Supports two formats:
 * - 'full' | 'schema' → custom format (binary, compressed, for pg_restore)
 * - 'selective' → plain SQL with INSERTs (for selective tenant restore)
 */
async function runPgDump(backupType: 'full' | 'schema' | 'selective', outputPath: string): Promise<void> {
  // Validate DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://'))) {
    throw new Error('Invalid DATABASE_URL format');
  }

  // Validate backup type
  if (!['full', 'schema', 'selective'].includes(backupType)) {
    throw new Error('Invalid backup type');
  }

  // Validate output path - must be a safe absolute path
  if (!outputPath.startsWith('/tmp/') && !outputPath.startsWith(process.env.BACKUP_LOCAL_DIR || '/invalid')) {
    throw new Error('Invalid output path');
  }

  const args = [
    dbUrl,
    '--no-owner',
    '--no-acl',
    '-f', outputPath,
  ];

  if (backupType === 'schema') {
    // Custom format with schema only
    args.push('--format=custom', '--compress=9', '--schema-only');
  } else if (backupType === 'selective') {
    // Plain SQL with INSERTs — parseable by backup-parser.ts
    args.push('--inserts', '--no-comments');
  } else {
    // 'full' — custom format for fast pg_restore
    args.push('--format=custom', '--compress=9');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, {
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/**
 * Safely run pg_dump --version
 */
async function getPgDumpVersion(): Promise<string> {
  try {
    const { stdout } = await exec('pg_dump --version');
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

// Called daily by cron — runs pg_dump, uploads to S3/R2 or keeps local
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!verifySecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1255): never run two backups concurrently.
  const lock = await acquireLock('cron:backup', 7200);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
  }

  const backupType = new URL(request.url).searchParams.get('type') || 'full';
  const t0 = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Use correct extension for format: .dump for custom, .sql for INSERT format
  const extension = backupType === 'selective' ? '.sql' : '.dump';
  const filename = `nucrm_${backupType}_${timestamp}${extension}`;
  const localDir = process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups';
  const localPath = `${localDir}/${filename}`;

  // Create backup record
  const [backup] = await db.insert(backupRecords).values({
    backupType: backupType as 'full' | 'schema' | 'selective',
    status: 'running',
    initiatedAuto: true,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }).returning();

  if (!backup) {
    return NextResponse.json({ error: 'Failed to create backup record' }, { status: 500 });
  }

  try {
    // Ensure local backup dir exists
    await ensureDir(localDir);

    // Run pg_dump with safe parameterized execution
    await runPgDump(backupType as 'full' | 'schema' | 'selective', localPath);

    const stats = await getFileStats(localPath);
    const sizeBytes = stats?.size || 0;

    // Digest the artefact as written, before anything moves or deletes it.
    const checksum = await checksumFile(localPath);

    let storagePath = localPath;
    let storageType = 'local';
    let offsiteError: string | null = null;
    const offsiteExpected = isS3Configured();

    if (offsiteExpected) {
      try {
        const uploaded = await uploadBackupArtifact({
          localPath,
          filename,
          checksum,
          storageClass: 'STANDARD_IA',
        });
        storagePath = uploaded.storagePath;
        storageType = uploaded.storageType;

        // Only drop the local copy once the upload has succeeded.
        await deleteFile(localPath);

        // Retention purge reads and deletes from the same bucket; previously it
        // listed from S3_BUCKET and deleted from BACKUP_BUCKET.
        const retention = resolveRetentionDays();
        try {
          const purged = await purgeExpiredBackups(retention);
          if (purged.deleted > 0) {
            console.log(`[backup] purged ${purged.deleted} expired object(s) from ${purged.bucket}`);
          }
        } catch (purgeErr) {
          // Retention is best-effort: a purge failure must not make a
          // successful backup look failed.
          await logError({ error: purgeErr, context: 'cron/backup:purgeExpiredBackups' });
        }
      } catch (uploadErr) {
        offsiteError = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        void logError({ error: uploadErr, context: 'cron/backup S3 upload failed, keeping local copy', level: 'warning' });
        storageType = 'local';
        storagePath = localPath;
      }
    } else {
      offsiteError = describeS3ConfigGap();
      if (offsiteError) {
        console.warn(`[backup] Backup kept local only: ${offsiteError}`);
      }
    }

    // Measured after the off-site upload so the recorded duration covers the
    // whole job, not just pg_dump.
    const durationMs = Date.now() - t0;

    // Mark completed and clear alerts atomically (transaction from #733),
    // carrying the checksum + off-site outcome from the backup hardening.
    await db.transaction(async (tx) => {
      await tx.update(backupRecords)
        .set({
          // Stays 'completed' even when the upload failed: the dump succeeded,
          // and /api/superadmin/restore only lists 'completed' rows, so a
          // separate status would hide the sole local copy from restore.
          status: 'completed',
          sizeBytes: sizeBytes,
          storagePath: storagePath,
          storageType: storageType,
          checksum,
          checksumAlgorithm: CHECKSUM_ALGORITHM,
          durationMs: durationMs,
          completedAt: new Date(),
          ...(offsiteError ? { errorMessage: offsiteError.slice(0, 500) } : {}),
          metadata: {
            pg_version: await getPgDumpVersion(),
            backup_type: backupType,
            offsite: !offsiteError,
            ...(offsiteError ? { offsite_error: offsiteError.slice(0, 500) } : {}),
          }
        })
        .where(eq(backupRecords.id, backup.id));

      await tx.update(backupAlerts)
        .set({
          resolved: true,
          resolvedAt: new Date()
        })
        .where(and(
          eq(backupAlerts.alertType, 'no_backup'),
          eq(backupAlerts.resolved, false)
        ));
    });

    if (offsiteError && offsiteExpected) {
      // Off-site storage is configured but rejected the upload, so the only
      // copy is on an ephemeral host. Page an operator rather than logging and
      // reporting success.
      await alertSuperAdmin(
        'WARNING: Database backup did not reach off-site storage',
        `Backup ${filename} completed locally but could not be uploaded.\n\n` +
        `Error: ${offsiteError}\n\n` +
        `The only copy is at ${localPath} on the application host and will be ` +
        `lost if the container is replaced. Check S3/R2 credentials and re-run.`
      ).catch((alertErr) => logError({ error: alertErr, context: 'cron/backup:offsiteAlert' }));
    }

    console.log(
      `[backup] completed: ${filename} (${(sizeBytes / 1024 / 1024).toFixed(1)}MB, ` +
      `${durationMs}ms, storage=${storageType}, offsite=${!offsiteError})`
    );
    return NextResponse.json({
      ok: true,
      filename,
      size_bytes: sizeBytes,
      duration_ms: durationMs,
      storage: storageType,
      checksum,
      checksum_algorithm: CHECKSUM_ALGORITHM,
      offsite: !offsiteError,
      ...(offsiteError ? { offsite_error: offsiteError } : {}),
    });

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    void logError({ error: err, context: 'cron/backup', level: 'fatal' });

    await db.transaction(async (tx) => {
      await tx.update(backupRecords)
        .set({
          status: 'failed',
          errorMessage: err.message.slice(0, 500),
          durationMs: durationMs
        })
        .where(eq(backupRecords.id, backup.id));

      await tx.insert(errorLogs).values({
        level: 'fatal',
        code: 'BACKUP_FAILED',
        message: `Automated backup failed: ${err.message}`,
        stack: err.stack?.slice(0, 2000)
      });
    });

    // Alert super admin
    await alertSuperAdmin(
      'CRITICAL: Automated Database Backup FAILED',
      `Time: ${new Date().toISOString()}\nError: ${err.message}\n\nManual backup required immediately:\n1. Check database connection\n2. Check disk space\n3. Run backup manually from superadmin console`
    ).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return apiError(err);
  }
}
