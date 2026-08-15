import { existsSync, unlinkSync } from 'fs';

const MAX_RESTORE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB safety limit

export async function downloadFromS3(backup: { storagePath: string; id: string }, s3Options: { bucket: string; region?: string; endpoint?: string }): Promise<string> {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { writeFile } = await import('fs/promises');
  const { Readable } = await import('stream');

  const tempPath = `/tmp/restore_${backup.id}.dump`;
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

  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_RESTORE_SIZE_BYTES) {
      throw new Error(
        `Restore file exceeded ${MAX_RESTORE_SIZE_BYTES / (1024 * 1024)} MB limit during download. Aborting.`
      );
    }
    chunks.push(Buffer.from(chunk));
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