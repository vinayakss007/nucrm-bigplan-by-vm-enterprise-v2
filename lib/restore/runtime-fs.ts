/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { existsSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const MAX_RESTORE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB safety limit

export async function downloadFromS3(backup: { storagePath: string; id: string }, s3Options: { bucket: string; region?: string; endpoint?: string }): Promise<string> {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { writeFile } = await import('fs/promises');

  const tempPath = join(tmpdir(), `restore_${backup.id}.dump`);
  const s3Client = new S3Client({
    region: s3Options.region || 'us-east-1',
    endpoint: s3Options.endpoint || undefined,
  });

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: s3Options.bucket,
    Key: backup.storagePath,
  }));

  if (!response.Body) {
    throw new Error('Failed to download backup from S3');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  // S3 Body may expose transformToByteArray (SDK v3) or be a readable stream
  const body = response.Body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof body.transformToByteArray === 'function') {
    const bytes = await body.transformToByteArray();
    totalBytes = bytes.byteLength;
    if (totalBytes > MAX_RESTORE_SIZE_BYTES) {
      throw new Error(
        `Restore file exceeded ${MAX_RESTORE_SIZE_BYTES / (1024 * 1024)} MB limit during download. Aborting.`
      );
    }
    chunks.push(Buffer.from(bytes));
  } else {
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      totalBytes += chunk.length;
      if (totalBytes > MAX_RESTORE_SIZE_BYTES) {
        throw new Error(
          `Restore file exceeded ${MAX_RESTORE_SIZE_BYTES / (1024 * 1024)} MB limit during download. Aborting.`
        );
      }
      chunks.push(Buffer.from(chunk));
    }
  }

  await writeFile(tempPath, Buffer.concat(chunks));
  return tempPath;
}

export async function checkFileExists(path: string): Promise<boolean> {
  return existsSync(path);
}

export async function deleteFile(path: string): Promise<void> {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}