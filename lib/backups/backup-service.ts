/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { backupRecords } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { spawn, exec as execCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { Pool } from 'pg';
import { pgSslConfig } from '@/lib/db/ssl-config';
import { checksumFile, CHECKSUM_ALGORITHM } from './integrity';
import { uploadBackupArtifact } from './offsite';
import { encryptBackupFile, isEncryptionEnabled } from './encrypt';
import { isS3Configured, describeS3ConfigGap } from '@/lib/storage/s3-config';
import { alertSuperAdmin } from '@/lib/email/service';
import { logger } from '@/lib/logger';

const exec = promisify(execCb);

export interface BackupOptions {
  backupType: 'full' | 'schema' | 'selective';
  initiatedBy?: string;
  initiatedAuto?: boolean;
}

export interface BackupResult {
  id: string;
  filename: string;
  localPath: string;
  sizeBytes: number;
  durationMs: number;
  storagePath: string;
  storageType: string;
  /** Digest of the dump, recorded so a restore can verify the artefact. */
  checksum: string;
  checksumAlgorithm: string;
  /** False when the dump only exists on the application host. */
  offsite: boolean;
  /** Why the off-site upload did not happen, when it did not. */
  offsiteError?: string;
  /** Whether the artefact is AES-256-GCM encrypted. */
  encrypted: boolean;
}

async function getPgDumpVersion(): Promise<string> {
  try {
    const { stdout } = await exec('pg_dump --version');
    return stdout.trim();
  } catch {
    // Fallback to default on corrupted storage data
    return 'unknown';
  }
}

export { getPgDumpVersion };

/**
 * The deployment is misconfigured for backups — nothing crashed, and no retry
 * will help until an operator changes something. Carries a status + a message
 * safe to show a super admin, so the panel can name the fix instead of sending
 * everyone to the server logs.
 */
export class BackupConfigurationError extends Error {
  readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'BackupConfigurationError';
  }
}

/**
 * Refuse to dump unless the target role can bypass row-level security.
 *
 * pg_dump emits `SET row_security = off` before it reads anything, and
 * PostgreSQL honours that only for a superuser or a BYPASSRLS role. Every
 * tenant table in this schema is created `WITH (force_row_security = true)` /
 * FORCE ROW LEVEL SECURITY, which keeps the tenant policy applied even to the
 * table owner. So a dump taken as the application role reads **zero rows** from
 * those tables and pg_dump still exits 0: the run is recorded `completed`, the
 * artefact has a plausible size (schema + global tables), and the first restore
 * that needs it recovers an empty CRM. PP-014/PP-015
 * (docs/infra/PREPROD-ISSUE-REGISTER.md).
 *
 * Checking is cheap (one query, one throwaway connection) and turns that
 * undetectable data-loss outcome into an error that names the fix.
 */
export async function assertDumpRoleCanReadAllTenants(dbUrl: string): Promise<void> {
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: pgSslConfig(),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  let role: string;
  let canBypass: boolean;
  try {
    const result = await pool.query<{ role: string; super: boolean; bypass: boolean }>(
      `select current_user::text as role, r.rolsuper, r.rolbypassrls
         from pg_roles r
        where r.rolname = current_user`,
    );
    const row = result.rows[0];
    if (!row) {
      throw new BackupConfigurationError(
        `Backup refused: the role for ${redactUrl(dbUrl)} does not exist in pg_roles`,
      );
    }
    role = row.role;
    canBypass = row.super || row.bypass;
  } finally {
    await pool.end();
  }

  if (!canBypass) {
    throw new BackupConfigurationError(
      `Backup refused: pg_dump role "${role}" is neither superuser nor BYPASSRLS. ` +
      'pg_dump runs `SET row_security = off`, which Postgres ignores for such a role, and ' +
      'every tenant table is FORCE ROW LEVEL SECURITY — the dump would contain zero tenant ' +
      'rows yet still report success. Set BACKUP_DATABASE_URL to a connection as a role with ' +
      'BYPASSRLS (see PP-014/PP-015 in docs/infra/PREPROD-ISSUE-REGISTER.md) before enabling ' +
      'backups.',
    );
  }
}

/** Connection strings carry passwords; only ever surface the host/database half. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(unparseable connection string)';
  }
}

/**
 * libpq PG* variables for a connection string, so a `pg_dump` / `pg_restore` /
 * `psql` child process gets its credentials from the environment instead of the
 * command line (`ps aux` and /proc/<pid>/cmdline are readable by any local
 * process). Shared with app/api/cron/backup-verify, which restores with
 * pg_restore/psql and had the URL as a positional argument.
 */
export function pgLibpqEnv(dbUrl: string): Record<string, string> {
  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error('Invalid DATABASE_URL format');
  }

  const pgEnv: Record<string, string> = {};
  if (parsed.hostname) pgEnv.PGHOST = decodeURIComponent(parsed.hostname);
  if (parsed.port) pgEnv.PGPORT = parsed.port;
  if (parsed.username) pgEnv.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) pgEnv.PGPASSWORD = decodeURIComponent(parsed.password);
  const database = parsed.pathname.replace(/^\//, '');
  if (database) pgEnv.PGDATABASE = decodeURIComponent(database);

  // Honor sslmode (and any other libpq-recognised query params) from the URL
  // so TLS behavior is preserved now that the URL is no longer passed directly.
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) pgEnv.PGSSLMODE = sslmode;

  return pgEnv;
}

export async function runPgDump(backupType: string, outputPath: string): Promise<void> {
  // PP-014/PP-015 (#2050/#2051): pg_dump runs `SET row_security = off`, which
  // PostgreSQL only honours for superuser/BYPASSRLS roles, while every tenant
  // table is FORCE ROW LEVEL SECURITY — the app role can never produce a
  // complete dump. Aim the dump at BACKUP_DATABASE_URL when configured.
  const dbUrl = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://'))) {
    throw new BackupConfigurationError('Backup refused: no usable DATABASE_URL / BACKUP_DATABASE_URL for pg_dump');
  }

  await assertDumpRoleCanReadAllTenants(dbUrl);

  if (!['full', 'schema', 'selective'].includes(backupType)) {
    throw new Error('Invalid backup type');
  }

  const resolvedOutputPath = path.resolve(outputPath);
  const localDir = path.resolve(process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups');
  if (!resolvedOutputPath.startsWith('/tmp/') && !resolvedOutputPath.startsWith(localDir)) {
    throw new Error('Invalid output path');
  }

  // Parse the connection string and pass credentials to pg_dump via the
  // environment (libpq PG* vars) rather than as a positional CLI argument.
  // A URL argument leaks user:password to `ps aux` and /proc/<pid>/cmdline,
  // where any local process can read it. libpq reads these env vars instead,
  // and the child's environment is not exposed by the process listing.
  const pgEnv = pgLibpqEnv(dbUrl);

  const args = [
    '--no-owner',
    '--no-acl',
    '-f', outputPath,
  ];

  if (backupType === 'schema') {
    args.push('--format=custom', '--compress=9', '--schema-only');
  } else if (backupType === 'selective') {
    args.push('--inserts', '--no-comments');
  } else {
    args.push('--format=custom', '--compress=9');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, {
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...pgEnv },
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

export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const { backupType, initiatedBy, initiatedAuto = false } = options;
  const t0 = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const extension = backupType === 'selective' ? '.sql' : '.dump';
  const filename = `nucrm_${backupType}_${timestamp}${extension}`;
  const localDir = process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups';
  const localPath = `${localDir}/${filename}`;

  const [fs] = await Promise.all([import('fs')]);

  const [backup] = await db.insert(backupRecords).values({
    backupType,
    status: 'running',
    createdBy: initiatedBy,
    initiatedAuto,
    expiresAt: sql`now() + interval '30 days'`,
  }).returning({ id: backupRecords.id });

  if (!backup) throw new Error('Failed to create backup record');

  try {
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

    await runPgDump(backupType, localPath);

    // Encrypt the dump if BACKUP_ENCRYPTION_KEY is configured. The plaintext
    // file is deleted and replaced with a .enc file. Encryption is opt-in so
    // existing deployments without the key continue working unchanged.
    let finalPath = localPath;
    let finalFilename = filename;
    const encrypted = isEncryptionEnabled();

    if (encrypted) {
      finalPath = await encryptBackupFile(localPath);
      finalFilename = `${filename}.enc`;
    }

    const sizeBytes = fs.statSync(finalPath).size;

    // Checksum the final artefact (encrypted if applicable), not the plaintext.
    // This validates storage integrity of what was actually uploaded.
    const checksum = await checksumFile(finalPath);

    let storagePath = finalPath;
    let storageType = 'local';
    let offsiteError: string | null = null;
    const offsiteExpected = isS3Configured();

    if (offsiteExpected) {
      try {
        const uploaded = await uploadBackupArtifact({ localPath: finalPath, filename: finalFilename, checksum });
        storagePath = uploaded.storagePath;
        storageType = uploaded.storageType;

        // Only drop the local copy once the upload has succeeded.
        fs.unlinkSync(finalPath);
      } catch (uploadErr) {
        offsiteError = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        logger.error('[backup-service] S3 upload failed, keeping local copy', { error: offsiteError });
      }
    } else {
      offsiteError = describeS3ConfigGap();
      if (offsiteError) {
        console.warn(`[backup-service] Backup kept local only: ${offsiteError}`);
      }
    }

    const durationMs = Date.now() - t0;

    // The dump itself did succeed, so the record stays 'completed'. Off-site
    // state is carried by storage_type ('local' vs 's3'/'s3_r2') plus
    // metadata.offsite, and a failure raises an operator alert below.
    //
    // Deliberately NOT a new status value: /api/superadmin/restore and
    // /api/cron/backup-health both filter on status = 'completed', so inventing
    // e.g. 'completed_local_only' would hide the local file from the restore
    // list — and that file is the only copy that exists.
    await db.update(backupRecords)
      .set({
        status: 'completed',
        sizeBytes,
        storagePath,
        storageType,
        checksum,
        checksumAlgorithm: CHECKSUM_ALGORITHM,
        durationMs,
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

    if (offsiteError && offsiteExpected) {
      // Off-site storage is configured but did not accept the upload, which
      // means the retention guarantee is currently broken. Tell an operator.
      await alertSuperAdmin(
        'WARNING: Database backup did not reach off-site storage',
        `Backup ${filename} completed locally but could not be uploaded.\n\n` +
        `Error: ${offsiteError}\n\n` +
        `The only copy is at ${localPath} on the application host and will be ` +
        `lost if the container is replaced. Investigate S3/R2 credentials and ` +
        `re-run the backup.`
      ).catch((err) => {
        logger.error('[backup-service] Failed to send off-site failure alert', { error: err instanceof Error ? err.message : String(err) });
      });
    }

    return {
      id: backup.id,
      filename: finalFilename,
      localPath: finalPath,
      sizeBytes,
      durationMs,
      storagePath,
      storageType,
      checksum,
      checksumAlgorithm: CHECKSUM_ALGORITHM,
      offsite: !offsiteError,
      encrypted,
      ...(offsiteError ? { offsiteError } : {}),
    };

 
 
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    const errMessage = err instanceof Error ? err.message : String(err);
    await db.update(backupRecords)
      .set({
        status: 'failed',
        errorMessage: errMessage.slice(0, 500),
        durationMs
      })
      .where(eq(backupRecords.id, backup.id));
    throw err;
  }
}
