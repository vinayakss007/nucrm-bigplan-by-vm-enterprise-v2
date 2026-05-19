import { existsSync, unlinkSync } from 'fs';

export async function downloadFromS3(backup: { storagePath: string; id: string }, s3Options: { bucket: string; region?: string; endpoint?: string }): Promise<string> {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { writeFile } = await import('fs/promises');

  const tempPath = `/tmp/restore_${backup.id}.dump`;
  const s3Client = new S3Client({
    region: s3Options.region || 'us-east-1',
    endpoint: s3Options.endpoint || undefined,
  });

  const response = await s3Client.send(new GetObjectCommand({
    Bucket: s3Options.bucket,
    Key: backup.storagePath,
  }));

  const fileBuffer = await response.Body?.transformToByteArray();
  if (!fileBuffer) {
    throw new Error('Failed to download backup from S3');
  }

  await writeFile(tempPath, fileBuffer);
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