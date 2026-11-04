/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { verifyCronSecret } from '@/lib/auth/cron';
import { refuseIfCronLockHeld } from '@/lib/cron/cron-lock';
import { NextRequest, NextResponse } from 'next/server';
import { backupRecords, backupAlerts, errorLogs } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { withSecurityContext } from '@/lib/db/rls';
import { alertSuperAdmin } from '@/lib/email/service';
import { ensureDir, deleteFile, getFileStats } from '@/lib/backups/runtime-fs';
import { logError } from '@/lib/errors-server';
import { getPgDumpVersion, runPgDump } from '@/lib/backups/backup-service';
import { checksumFile, CHECKSUM_ALGORITHM } from '@/lib/backups/integrity';
import { uploadBackupArtifact, purgeExpiredBackups, resolveRetentionDays } from '@/lib/backups/offsite';
import { isS3Configured, describeS3ConfigGap } from '@/lib/storage/s3-config';
import { classifyBackupError, backupFailure, BACKUP_ERROR_CODES, type ClassifiedBackupError } from '@/lib/backups/backup-error';

/**
 * The failure path of this job, in one place.
 *
 * It used to live inline in the `catch` at the bottom of POST, while the
 * `backup_records` INSERT ran *above* that `try`. So the one failure that proves
 * the nightly is broken — the write that would have recorded it — produced no log
 * line, no `error_logs` row, no email and no row: only the 33-byte body #3275 saw
 * in the access log. `error_logs.code` also carried the one literal 'BACKUP_FAILED'
 * for every cause; it now carries the cause, in the same code the answer uses.
 */
async function reportBackupFailure(
  err: unknown,
  opts: { filename: string; backupId?: string; durationMs: number; as?: ClassifiedBackupError },
): Promise<ClassifiedBackupError> {
  const classified = opts.as ?? classifyBackupError(err);
  const detail = err instanceof Error ? (err.message ?? String(err)) : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  void logError({ error: err, context: 'cron/backup FAILED', metadata: { code: classified.code } });

  try {
    await withSecurityContext(async (tx) => {
      if (opts.backupId) {
        await tx.update(backupRecords)
          .set({
            status: 'failed',
            errorMessage: detail.slice(0, 500),
            durationMs: opts.durationMs
          })
          .where(eq(backupRecords.id, opts.backupId));
      }

      await tx.insert(errorLogs).values({
        level: 'fatal',
        code: classified.code,
        message: `Automated backup failed (${opts.filename}): ${detail}`,
        stack: stack?.slice(0, 2000)
      });
    });
  } catch (reportErr) {
    // When the write that failed *is* the backup_records INSERT, the report cannot
    // ride on the same write. Log the second failure and let the email below stand alone.
    void logError({ error: reportErr, context: 'cron/backup: failure not recorded', level: 'warning' });
  }

  const failedAlerted = await alertSuperAdmin(
    `CRITICAL: Automated Database Backup FAILED (${classified.code})`,
    `Time: ${new Date().toISOString()}\nCode: ${classified.code}\nFile: ${opts.filename}\n` +
    `What to do: ${classified.message}\n\nServer detail: ${detail.slice(0, 500)}\n\n` +
    'Manual backup required immediately:\n1. Check database connection\n2. Check disk space\n3. Run backup manually from superadmin console'
  );
  if (!failedAlerted.success) {
    await logError({
      error: new Error(`Backup-failure alert not delivered: ${failedAlerted.error ?? 'provider failure'}`),
      context: 'cron/backup async side-effect',
    });
  }

  return classified;
}

// Called daily by cron — runs pg_dump, uploads to S3/R2 or keeps local
export async function POST(request: NextRequest) {
  if (!await verifyCronSecret(request, { job: 'backup' })) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1255): never run two backups concurrently.
  const refusal = await refuseIfCronLockHeld('cron:backup', 7200);
  if (refusal) return refusal;

  const requestedType = new URL(request.url).searchParams.get('type') || 'full';
  // Validated before it reaches either the backup_records enum or the filename:
  // the old code interpolated `?type=` straight into
  // `nucrm_${backupType}_${timestamp}`, so `?type=../../x` escaped the backup dir.
  if (!['full', 'schema', 'selective'].includes(requestedType)) {
    const invalid = backupFailure(BACKUP_ERROR_CODES.TYPE_INVALID);
    return NextResponse.json({ error: invalid.message, code: invalid.code }, { status: invalid.status });
  }
  const backupType = requestedType as 'full' | 'schema' | 'selective';
  const t0 = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Use correct extension for format: .dump for custom, .sql for INSERT format
  const extension = backupType === 'selective' ? '.sql' : '.dump';
  const filename = `nucrm_${backupType}_${timestamp}${extension}`;
  const localDir = process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups';
  const localPath = `${localDir}/${filename}`;

  // Create backup record
  //
  // backup_records has one FOR ALL policy whose USING clause is `is_super_admin`, and
  // Postgres reuses USING as WITH CHECK for an ALL-COMMANDS policy, so this INSERT is
  // refused with 42501 on the bare pool handle (lib/db/pool.ts normalises every checkout
  // to app.is_super_admin='false'). Same for the two write transactions below.
  let backup: { id: string } | undefined;
  try {
    [backup] = await withSecurityContext((tx) => tx.insert(backupRecords).values({
      backupType,
      status: 'running',
      initiatedAuto: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }).returning({ id: backupRecords.id }));
  } catch (err) {
    const classified = await reportBackupFailure(err, { filename, durationMs: Date.now() - t0 });
    return apiError(err, classified.message, classified.status);
  }

  if (!backup) {
    // No row back from INSERT ... RETURNING means the same thing as a refusal: this
    // run is not in backup_records, so nothing downstream can tell it happened. The
    // cause is known, so it does not go through the classifier.
    const refused = new Error(`backup_records INSERT returned no row for ${filename}`);
    const classified = await reportBackupFailure(refused, {
      filename,
      durationMs: Date.now() - t0,
      as: backupFailure(BACKUP_ERROR_CODES.RECORD_WRITE_FAILED),
    });
    return apiError(refused, classified.message, classified.status);
  }

  const backupId = backup.id;

  try {
    // Ensure local backup dir exists
    await ensureDir(localDir);

    // Run pg_dump with safe parameterized execution
    await runPgDump(backupType, localPath);

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
        void logError({ error: uploadErr, context: 'cron/backup S3 upload (kept local copy)', level: 'warning' });
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
    await withSecurityContext(async (tx) => {
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
      const offsiteAlerted = await alertSuperAdmin(
        'WARNING: Database backup did not reach off-site storage',
        `Backup ${filename} completed locally but could not be uploaded.\n\n` +
        `Error: ${offsiteError}\n\n` +
        `The only copy is at ${localPath} on the application host and will be ` +
        `lost if the container is replaced. Check S3/R2 credentials and re-run.`
      );
      if (!offsiteAlerted.success) {
        await logError({
          error: new Error(`Off-site alert not delivered: ${offsiteAlerted.error ?? 'provider failure'}`),
          context: 'cron/backup:offsiteAlert',
        });
      }
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

  } catch (err) {
    const classified = await reportBackupFailure(err, { filename, backupId, durationMs: Date.now() - t0 });
    return apiError(err, classified.message, classified.status);
  }
}
