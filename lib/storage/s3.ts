/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * S3 Backup Module
 * Handles database backups to S3/R2
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getS3Config } from './s3-config';
import { ensureBucket } from './ensure-bucket';
import { s3ClientOptions } from './s3-client';

// Resolved through getS3Config() so that S3_ACCESS_KEY / S3_SECRET_KEY (the
// names docker-compose exports) are honoured as well as the AWS-style
// S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY.
const s3Config = getS3Config();

const s3Client = new S3Client(s3ClientOptions(s3Config));

const BUCKET = s3Config.backupBucket || 'nucrm-backups';
const BACKUP_PREFIX = 'backups/';

export async function uploadBackup(backupData: Buffer, filename: string): Promise<string> {
  const key = `${BACKUP_PREFIX}${filename}`;

  await ensureBucket(BUCKET, s3Config, s3Client);

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: backupData,
    ContentType: 'application/sql',
    Metadata: {
      'created-at': new Date().toISOString(),
      'app': 'nucrm',
    },
  }));

  return key;
}

export async function listBackups(): Promise<{ key: string; size: number; lastModified: Date }[]> {
  const response = await s3Client.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: BACKUP_PREFIX,
  }));

  return (response.Contents || []).map(item => ({
    key: item.Key || '',
    size: item.Size || 0,
    lastModified: item.LastModified || new Date(),
  })).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

const MAX_BACKUP_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB safety limit

export async function downloadBackup(key: string): Promise<Buffer> {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));

  if (response.ContentLength && response.ContentLength > MAX_BACKUP_SIZE_BYTES) {
    const sizeMB = (response.ContentLength / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Backup too large to load into memory (${sizeMB} MB). ` +
      `Maximum allowed is ${MAX_BACKUP_SIZE_BYTES / (1024 * 1024)} MB. ` +
      'Use streaming or signed-URL download for larger files.'
    );
  }
  // When ContentLength is unavailable (some S3-compatible providers), the
  // streaming loop below still enforces MAX_BACKUP_SIZE_BYTES via totalBytes.

  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BACKUP_SIZE_BYTES) {
      throw new Error(
        `Backup exceeded ${MAX_BACKUP_SIZE_BYTES / (1024 * 1024)} MB limit during download. Aborting.`
      );
    }
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

// No deleteOldBackups() here. It trimmed the bucket to the newest `keepCount`
// objects with no regard for age, so a burst of same-day dumps could expire a
// restore point minutes after it was written. Bucket expiry now lives solely in
// purgeWithTieredRetention() (lib/backups/offsite.ts), which enforces the
// MIN_RETENTION_DAYS floor and the mass-delete guard.

export async function uploadFileToS3(
  data: Buffer | Uint8Array,
  key: string,
  contentType: string = 'application/octet-stream',
  bucket?: string
): Promise<string> {
  const target = bucket || BUCKET;
  await ensureBucket(target, s3Config, s3Client);

  await s3Client.send(new PutObjectCommand({
    Bucket: target,
    Key: key,
    Body: data,
    ContentType: contentType,
  }));
  
  return key;
}

export async function getSignedUrl(key: string, expiresIn: number = 3600, bucket?: string): Promise<string> {
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const command = new GetObjectCommand({ Bucket: bucket || BUCKET, Key: key });
 
 
  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Read an object's real length back from the store.
 *
 * #3297: `documents.size_bytes` is the number `max_storage_gb` is metered from, and
 * it was only ever what the upload client put in the POST body
 * (`app/api/tenant/documents/route.ts:126`) — nothing compared it to the bytes that
 * actually landed. `grep -rn "HeadObject\|headObject" app lib` answered 0 before
 * this, so there was no way to ask.
 *
 * The return type carries the distinction the caller has to respect: `null` means
 * the store positively says the key is not there, and ONLY that. A 503, a timeout,
 * a bad bucket or an answer with no length THROWS — the settle route soft-deletes on
 * `null`, so collapsing an outage into "absent" would drop a tenant's whole library
 * from the meter on one bad gateway turn.
 */
export async function headObjectSize(key: string, bucket?: string): Promise<number | null> {
  let head: HeadObjectCommandOutput | undefined;
  try {
    head = await s3Client.send(new HeadObjectCommand({
      // Documents live in the user-files bucket, not the backup bucket BUCKET
      // defaults to; a document row with no s3Bucket must still be measured where
      // its bytes are.
      Bucket: bucket || s3Config.bucket || BUCKET,
      Key: key,
    }));
  } catch (err) {
    const name = (err as { name?: string } | null)?.name ?? '';
    const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
    if (status === 404 || name === 'NoSuchKey' || name === 'NotFound') return null;
    // AccessDenied, SlowDown, 503, a DNS failure — all unknown, all fatal to a
    // caller that is about to trust an absence. Never a null.
    throw err;
  }

  // A HEAD that returned no body at all is how a gateway answers a missing key.
  if (head == null) return null;
  if (typeof head.ContentLength !== 'number') {
    throw new Error(`store answered HEAD for ${key} without a length — treating unknown as 0 would credit back bytes in use`);
  }
  return head.ContentLength;
}

/**
 * Generate a presigned PUT URL for direct browser uploads. The browser
 * uploads bytes straight to S3/R2; the server only records metadata
 * after the upload reports success. ContentType is locked into the URL
 * so the browser must re-send it on PUT.
 *
 * #3297 made the byte size required. SigV4 signs whatever is in the command —
 * measured on this repo: a PutObjectCommand with `ContentLength: 1024` comes back
 * with `X-Amz-SignedHeaders=content-length;host`, so a body of any other length is
 * rejected by the store. Leaving the option optional meant the old
 * `...(args.contentLengthBytes ? … : {})` quietly minted an UNBOUND URL whenever a
 * caller forgot it, and an unbound URL is exactly the hole: a row metered at 1 byte
 * whose object is 100 MB. A caller that has no length to declare has no business
 * signing an upload.
 */
export async function getSignedPutUrl(args: {
  key: string;
  contentType: string;
  contentLengthBytes: number;
  expiresInSeconds?: number;
  bucket?: string;
}): Promise<string> {
  const declared = args.contentLengthBytes;
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
    throw new Error(`getSignedPutUrl requires a positive contentLengthBytes for ${args.key} (got ${String(declared)})`);
  }
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  // Asked before the URL is minted, not after the browser has the bytes: a PUT to a
  // bucket that does not exist would otherwise surface as a raw store response in
  // the visitor's devtools with no NuCRM error path behind it (#3258).
  await ensureBucket(args.bucket || BUCKET, s3Config, s3Client);
  const command = new PutObjectCommand({
    Bucket: args.bucket || BUCKET,
    Key: args.key,
    ContentType: args.contentType,
    ContentLength: declared,
  });
 
 
  return getSignedUrl(s3Client, command, {
    expiresIn: args.expiresInSeconds ?? 600, // 10 minutes
  });
}

/** Hard-delete a single object. Caller decides what to do about the metadata row. */
export async function deleteObject(key: string, bucket?: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket || BUCKET, Key: key }));
}
