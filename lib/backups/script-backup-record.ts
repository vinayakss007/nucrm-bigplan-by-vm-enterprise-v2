/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Runbook-script backup registration (#2237).
 *
 * `scripts/backup-db.sh` (the dump the DISASTER-RECOVERY runbook tells
 * operators to cron) used to upload to MinIO without ever touching
 * `backup_records`, while `scripts/restore-db.ts`, `scripts/verify-backup.ts`
 * and `/api/superadmin/restore` pick candidates from that table only — so the
 * daily dumps were invisible to the restore flow and never verified.
 *
 * This module is the single registration path the script calls (via
 * `scripts/register-script-backup.ts`). It writes the exact same columns and
 * status vocabulary as the app's own backup path
 * (`lib/backups/backup-service.ts`): `running → completed | failed`, checksum
 * + `sha256` algorithm on success, redacted `error_message` on failure, a
 * 30-day `expires_at`, and a `metadata.source` discriminator
 * ('runbook_script') so operators can tell script dumps from app dumps —
 * restore/verify deliberately do NOT filter on it, which is the whole point:
 * these dumps must be selectable for restore.
 *
 * Credentials safety: the connection string never reaches this module; the
 * script passes only filename/size/checksum/object-key values, and failures
 * are stored through `errorText`/`truncateForStore` (redaction first, then
 * slice) exactly like backup-service (#62), so bound parameters logged by
 * upstream tools cannot land in `error_message`.
 */
import { db } from '@/drizzle/db';
import { backupRecords } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { errorText, truncateForStore } from '@/lib/error-redaction';
import { CHECKSUM_ALGORITHM } from './integrity';

/** metadata.source value distinguishing script dumps from app-path dumps. */
export const RUNBOOK_BACKUP_SOURCE = 'runbook_script';
export const RUNBOOK_BACKUP_SCRIPT = 'scripts/backup-db.sh';

export interface RunbookBackupHandle {
  id: string;
  filename: string;
}

/**
 * Open a catalog row for a dump that is about to be taken. Mirrors the
 * `status: 'running'` INSERT in backup-service.createBackup() so a crashed or
 * aborted run is visible in the catalog instead of silently absent.
 */
export async function beginRunbookBackupRecord(opts: {
  filename: string;
  backupType?: 'full' | 'schema' | 'selective';
}): Promise<RunbookBackupHandle> {
  const backupType = opts.backupType ?? 'full';
  const [row] = await db
    .insert(backupRecords)
    .values({
      backupType,
      status: 'running',
      initiatedAuto: true,
      expiresAt: sql`now() + interval '30 days'`,
      metadata: {
        source: RUNBOOK_BACKUP_SOURCE,
        script: RUNBOOK_BACKUP_SCRIPT,
        filename: opts.filename,
        backup_type: backupType,
      },
    })
    .returning({ id: backupRecords.id });

  if (!row) {
    throw new Error('Failed to create backup_records row for runbook dump');
  }
  return { id: row.id, filename: opts.filename };
}

/**
 * Mark the dump completed with everything a restore needs to locate and
 * verify it: object key, storage type, byte size and SHA-256 checksum —
 * the same fields backup-service writes on its success path.
 */
export async function completeRunbookBackupRecord(opts: {
  id: string;
  filename: string;
  sizeBytes: number;
  /** Object key (or local path) as restore-db/verify-backup must fetch it. */
  storagePath: string;
  /** 's3' | 's3_r2' | 'local', matching backup-service vocabulary. */
  storageType: string;
  checksum: string;
  durationMs: number;
  /** Bucket the object lives in; recorded in metadata for operators. */
  bucket?: string;
}): Promise<void> {
  await db
    .update(backupRecords)
    .set({
      status: 'completed',
      sizeBytes: opts.sizeBytes,
      storagePath: opts.storagePath,
      storageType: opts.storageType,
      checksum: opts.checksum,
      checksumAlgorithm: CHECKSUM_ALGORITHM,
      durationMs: opts.durationMs,
      completedAt: new Date(),
      metadata: {
        source: RUNBOOK_BACKUP_SOURCE,
        script: RUNBOOK_BACKUP_SCRIPT,
        filename: opts.filename,
        backup_type: 'full',
        offsite: opts.storageType !== 'local',
        ...(opts.bucket ? { bucket: opts.bucket } : {}),
      },
    })
    .where(eq(backupRecords.id, opts.id));
}

/**
 * Mark the dump failed. Same redaction as the app path:
 * `truncateForStore(errorText(err), 500)` — never raw drizzle/pg errors with
 * bound parameters, never credentials.
 */
export async function failRunbookBackupRecord(opts: {
  id: string;
  error: unknown;
  durationMs?: number;
}): Promise<void> {
  const errorMessage = truncateForStore(
    opts.error instanceof Error
      ? errorText(opts.error)
      : errorText(opts.error ?? 'backup-db.sh failed with an unknown error'),
    500,
  );
  await db
    .update(backupRecords)
    .set({
      status: 'failed',
      errorMessage,
      ...(opts.durationMs !== undefined ? { durationMs: opts.durationMs } : {}),
    })
    .where(eq(backupRecords.id, opts.id));
}
