/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
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
import { applyRetentionPolicy, readRetentionConfig, MIN_RETENTION_DAYS, type BackupEntry } from './retention-policy';

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

/**
 * Retention used when the operator sets nothing. It IS the floor: a scheduled
 * purge with no configuration must never be the shortest window in the system
 * (it used to be 30 days, which is why #2233's restore points could age out
 * before anyone noticed).
 */
export const DEFAULT_RETENTION_DAYS = MIN_RETENTION_DAYS;

/**
 * Resolve the backup retention window in days.
 *
 * Two names for this setting grew up independently: the cron route read
 * `BACKUP_RETENTION_DAYS` while `.env.example` documented — and
 * `scripts/backup-db.ts` read — `BACKUP_KEEP_DAYS`. An operator following the
 * example file therefore had no effect on the scheduled purge. Accept both,
 * canonical name first, and ignore values that are not a positive integer so a
 * typo cannot silently expand or collapse retention.
 *
 * The result is clamped UP to MIN_RETENTION_DAYS: the flat "delete after N
 * days" model is the least safe of the purge paths, so an operator value below
 * the retention floor (or the 30-day default) can never shorten it. Callers who
 * genuinely want a shorter window must pass it straight to
 * purgeExpiredBackups(), which stays faithful to its argument.
 */
export function resolveRetentionDays(): number {
  let resolved = DEFAULT_RETENTION_DAYS;

  for (const name of ['BACKUP_RETENTION_DAYS', 'BACKUP_KEEP_DAYS'] as const) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') continue;

    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      resolved = parsed;
      break;
    }

    console.warn(
      `[backups] Ignoring invalid ${name}="${raw}"; using ${DEFAULT_RETENTION_DAYS} days`
    );
  }

  if (resolved < MIN_RETENTION_DAYS) {
    console.warn(
      `[backups] Retention ${resolved}d is below the ${MIN_RETENTION_DAYS}d floor; ` +
        `purging nothing younger than ${MIN_RETENTION_DAYS} days (#2233 follow-up).`
    );
    return MIN_RETENTION_DAYS;
  }
  return resolved;
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

/**
 * Tiered backup retention (GFS: Grandfather-Father-Son).
 *
 * Instead of a flat retention window, this applies a tiered policy:
 *   30 daily | 12 weekly | 6 monthly | 2 yearly
 *
 * Use this in preference to purgeExpiredBackups() when the full policy is
 * desired. purgeExpiredBackups() is preserved for backward compatibility and
 * for environments that prefer the simpler "delete after N days" model.
 */
export async function purgeWithTieredRetention(): Promise<{
  kept: number;
  deleted: number;
  bucket: string;
  /** True when the mass-delete guard refused the run — see applyRetentionPolicy. */
  guardTriggered: boolean;
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
  const entries: BackupEntry[] = [];
  let continuationToken: string | undefined;

  // Collect all backup objects
  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'backups/',
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of listed.Contents ?? []) {
      if (obj.Key && obj.LastModified) {
        entries.push({ key: obj.Key, createdAt: obj.LastModified });
      }
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  // Apply the GFS policy
  const retentionConfig = readRetentionConfig();
  const decision = applyRetentionPolicy(entries, retentionConfig);

  if (decision.guardTriggered) {
    console.warn(
      `[backups] Tiered purge would have expired ${decision.guardBlocked} of ${entries.length} ` +
        `objects, over the ${(retentionConfig.maxDeleteRatio ?? 1) * 100}% per-run limit — ` +
        `deleting NOTHING. Check that the bucket listing is complete before retrying ` +
        `(#2233 follow-up).`,
    );
  }

  // Delete the expired objects in batches of 1000 (S3 limit)
  let deleted = 0;
  const toDelete = decision.delete.map((d) => ({ Key: d.entry.key }));

  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch },
      })
    );
    deleted += batch.length;
  }

  return {
    kept: decision.keep.length,
    deleted,
    bucket,
    guardTriggered: decision.guardTriggered,
  };
}
