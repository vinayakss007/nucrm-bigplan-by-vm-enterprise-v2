/**
 * Off-site backup storage.
 *
 * Both the manual backup service and the nightly cron route previously carried
 * their own copy of this upload logic, and both copies were broken in the same
 * way (see lib/storage/s3-config.ts). Keeping one implementation here means a
 * fix or a hardening applies to every backup path at once.
 */

import type { StorageClass } from '@aws-sdk/client-s3';
import { getS3Config, describeS3ConfigGap } from '@/lib/storage/s3-config';

export interface UploadResult {
  /** Key of the object in the bucket. */
  storagePath: string;
  /** `s3` or `s3_r2`, matching backup_records.storage_type. */
  storageType: 's3' | 's3_r2';
  bucket: string;
}

/**
 * Upload a local dump to the configured backup bucket.
 *
 * Throws on any failure. Callers must treat a rejection as "this backup is NOT
 * off-site" and must not record the backup as fully completed — see
 * {@link OffsiteUploadError}.
 */
export async function uploadBackupArtifact(args: {
  localPath: string;
  filename: string;
  /** Optional SHA-256 digest, stored as object metadata for cross-checking. */
  checksum?: string;
  /** Passed through to S3; STANDARD_IA suits write-once backup objects. */
  storageClass?: StorageClass;
}): Promise<UploadResult> {
  const cfg = getS3Config();
  const gap = describeS3ConfigGap();
  if (gap || !cfg.backupBucket) {
    throw new OffsiteUploadError(gap ?? 'S3 backup bucket not configured');
  }

  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { readFile } = await import('fs/promises');

  const s3Client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: cfg.credentials,
  });

  const body = await readFile(args.localPath);
  const storagePath = `backups/${args.filename}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: cfg.backupBucket,
      Key: storagePath,
      Body: body,
      ...(args.storageClass ? { StorageClass: args.storageClass } : {}),
      ...(args.checksum
        ? { Metadata: { 'content-sha256': args.checksum } }
        : {}),
    })
  );

  return {
    storagePath,
    storageType: cfg.storageType,
    bucket: cfg.backupBucket,
  };
}

/** Raised when a backup could not be placed in off-site storage. */
export class OffsiteUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OffsiteUploadError';
  }
}

export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Resolve the backup retention window in days.
 *
 * Two names for this setting grew up independently: the cron route read
 * `BACKUP_RETENTION_DAYS` while `.env.example` documented — and
 * `scripts/backup-db.ts` read — `BACKUP_KEEP_DAYS`. An operator following the
 * example file therefore had no effect on the scheduled purge. Accept both,
 * canonical name first, and ignore values that are not a positive integer so a
 * typo cannot silently expand or collapse retention.
 */
export function resolveRetentionDays(): number {
  for (const name of ['BACKUP_RETENTION_DAYS', 'BACKUP_KEEP_DAYS'] as const) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') continue;

    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;

    console.warn(
      `[backups] Ignoring invalid ${name}="${raw}"; using ${DEFAULT_RETENTION_DAYS} days`
    );
  }
  return DEFAULT_RETENTION_DAYS;
}

/**
 * Delete backup objects older than the retention window.
 *
 * Reads and writes the *same* bucket. The previous implementation listed keys
 * from `S3_BUCKET` but issued the delete against `BACKUP_BUCKET`; when those
 * differed it deleted keys from the wrong bucket, and when `BACKUP_BUCKET` was
 * unset it sent `Bucket: undefined` and the error was swallowed so retention
 * silently never ran.
 */
export async function purgeExpiredBackups(retentionDays: number): Promise<{
  deleted: number;
  bucket: string;
}> {
  const cfg = getS3Config();
  if (!cfg.configured || !cfg.backupBucket) {
    throw new OffsiteUploadError(
      describeS3ConfigGap() ?? 'S3 backup bucket not configured'
    );
  }

  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import(
    '@aws-sdk/client-s3'
  );

  const s3Client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: cfg.credentials,
  });

  const bucket = cfg.backupBucket;
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  let deleted = 0;
  let continuationToken: string | undefined;

  // Paginate: ListObjectsV2 caps at 1000 keys, so a single unpaginated call
  // would quietly stop purging once the prefix grew past that.
  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'backups/',
        ContinuationToken: continuationToken,
      })
    );

    const expired = (listed.Contents ?? [])
      .filter((obj) => obj.Key && obj.LastModified && obj.LastModified < cutoff)
      .map((obj) => ({ Key: obj.Key as string }));

    if (expired.length > 0) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: expired },
        })
      );
      deleted += expired.length;
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return { deleted, bucket };
}
