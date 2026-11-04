/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3275 — one code per cause of a failed backup run.
 *
 * `POST /api/cron/backup` answered 500 for at least three different operator
 * actions: the dump role is not BYPASSRLS (change the env), `pg_dump` is not on
 * the image (change the image), and Postgres refused the `backup_records` INSERT
 * (fix the grant or the policy). From the access log, the cron output and
 * `backup_records.status` all three looked like the same "500, retry tomorrow".
 *
 * A pure function over the thrown value, so classification is testable without a
 * database, a `pg_dump` or an S3 endpoint. Its test feeds it what the real
 * `runPgDump` and drizzle's real rethrow produce, so a message that gets reworded
 * out of its branch fails a test instead of quietly degrading everything to
 * `BACKUP_FAILED`.
 */
import { BackupConfigurationError } from '@/lib/backups/backup-service';
import { dbQueryFailureDiagnostics } from '@/lib/api/db-client-error';

export const BACKUP_ERROR_CODES = {
  /** `?type=` is not one of the three the enum and the filename both accept. */
  TYPE_INVALID: 'BACKUP_TYPE_INVALID',
  /** Postgres refused the `backup_records` write with 42501 — so this run went unrecorded. */
  RECORD_WRITE_REFUSED: 'BACKUP_RECORD_WRITE_REFUSED',
  /** The `backup_records` write failed for a reason that is not a permission refusal. */
  RECORD_WRITE_FAILED: 'BACKUP_RECORD_WRITE_FAILED',
  /** The deployment is misconfigured for backups; the message names the env var to set. */
  CONFIG_REFUSED: 'BACKUP_CONFIG_REFUSED',
  /** `spawn('pg_dump')` raised ENOENT — the binary is not installed on this image. */
  DUMP_BINARY_MISSING: 'BACKUP_DUMP_BINARY_MISSING',
  /** pg_dump ran and exited non-zero. */
  DUMP_FAILED: 'BACKUP_DUMP_FAILED',
  /** Anything else. The exception text stays in the log, the code stays generic. */
  FAILED: 'BACKUP_FAILED',
} as const;

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[keyof typeof BACKUP_ERROR_CODES];

export type ClassifiedBackupError = {
  code: BackupErrorCode;
  status: number;
  /** Safe for a response body: static text, or a message already written for a super admin. */
  message: string;
};

/**
 * These name the fix, not the exception. The exception text belongs in `logError`,
 * `error_logs` and `backup_records.error_message` — never in the body (#2285: a
 * driver message carries table and column names, tenant UUIDs and one-time
 * tokens, and pg_dump's stderr can carry the connection string).
 */
const STATIC: Partial<Record<BackupErrorCode, string>> = {
  [BACKUP_ERROR_CODES.TYPE_INVALID]: "Invalid backup type: expected 'full', 'schema' or 'selective'",
  [BACKUP_ERROR_CODES.RECORD_WRITE_REFUSED]:
    'Backup refused: the database denied the backup_records write, so this run could not be recorded. ' +
    'The app role needs the RLS bootstrap grant (0088) — see PP-014/PP-015.',
  [BACKUP_ERROR_CODES.RECORD_WRITE_FAILED]: 'Backup failed: the backup_records row could not be created.',
  [BACKUP_ERROR_CODES.DUMP_BINARY_MISSING]:
    'Backup refused: pg_dump is not installed on this host. Nothing changes until the image carries the matching client tools.',
  [BACKUP_ERROR_CODES.DUMP_FAILED]: 'Backup failed: pg_dump exited non-zero.',
  [BACKUP_ERROR_CODES.FAILED]: 'Backup failed.',
};

function staticText(code: BackupErrorCode): string {
  return (STATIC[code] ?? STATIC[BACKUP_ERROR_CODES.FAILED]) as string;
}

/**
 * The two causes the operator can act on immediately without a retry — a config
 * refusal and a missing binary — answer 503; everything else is a server fault.
 */
const STATUS: Partial<Record<BackupErrorCode, number>> = {
  [BACKUP_ERROR_CODES.TYPE_INVALID]: 400,
  [BACKUP_ERROR_CODES.RECORD_WRITE_REFUSED]: 503,
  [BACKUP_ERROR_CODES.CONFIG_REFUSED]: 503,
  [BACKUP_ERROR_CODES.DUMP_BINARY_MISSING]: 503,
};

/**
 * A failure whose cause is already known, so there is no exception to read it
 * from: `INSERT … RETURNING` giving back no row is the record-write cause, not
 * whatever a generic classifier would have guessed from the message.
 */
export function backupFailure(code: BackupErrorCode): ClassifiedBackupError {
  return { code, status: STATUS[code] ?? 500, message: staticText(code) };
}

/**
 * `child_process.spawn` reports a missing binary as an error event on the child
 * (ENOENT), not as a non-zero exit, so it never reaches the
 * `pg_dump failed with code N` branch below.
 */
function isMissingBinary(err: unknown, text: string): boolean {
  return (err as { code?: unknown }).code === 'ENOENT' && /pg_dump|pg_restore/.test(text);
}

export function classifyBackupError(err: unknown): ClassifiedBackupError {
  const text = err instanceof Error ? err.message : String(err);

  if (err instanceof BackupConfigurationError) {
    // Its message is written to be shown to a super admin — it names the env var
    // to set — so it is the one case carried through instead of replaced.
    return { ...backupFailure(BACKUP_ERROR_CODES.CONFIG_REFUSED), message: err.message };
  }

  if (isMissingBinary(err, text)) return backupFailure(BACKUP_ERROR_CODES.DUMP_BINARY_MISSING);

  // The dump's own failure text is `pg_dump failed with code N: <stderr>`; the
  // stderr half belongs in the log, not in the body.
  if (/^pg_dump failed with code /.test(text)) return backupFailure(BACKUP_ERROR_CODES.DUMP_FAILED);

  const sqlState = dbQueryFailureDiagnostics(err, text)?.code;
  if (sqlState === '42501') return backupFailure(BACKUP_ERROR_CODES.RECORD_WRITE_REFUSED);
  if (sqlState) return backupFailure(BACKUP_ERROR_CODES.RECORD_WRITE_FAILED);

  return backupFailure(BACKUP_ERROR_CODES.FAILED);
}
