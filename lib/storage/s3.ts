/**
 * S3 Backup Module
 * Handles database backups to S3/R2
 */

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3Client = new S3Client({
  region: process.env['S3_REGION'] || 'auto',
  endpoint: process.env['S3_ENDPOINT'], // For R2: https://xxx.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] || '',
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] || '',
  },
});

const BUCKET = process.env['S3_BUCKET'] || 'nucrm-backups';
const BACKUP_PREFIX = 'backups/';

export async function uploadBackup(backupData: Buffer, filename: string): Promise<string> {
  const key = `${BACKUP_PREFIX}${filename}`;
  
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

export async function downloadBackup(key: string): Promise<Buffer> {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));

  const stream = response.Body as Readable;
  const chunks: Buffer[] = [];
  
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  
  return Buffer.concat(chunks);
}

export async function deleteOldBackups(keepCount: number = 30): Promise<void> {
  const backups = await listBackups();
  
  if (backups.length <= keepCount) return;
  
  const toDelete = backups.slice(keepCount);
  const objectsToDelete = toDelete.map(b => ({ Key: b.key }));
  
  await s3Client.send(new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: { Objects: objectsToDelete },
  }));
}

export async function uploadFileToS3(
  data: Buffer | Uint8Array,
  key: string,
  contentType: string = 'application/octet-stream'
): Promise<string> {
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: data,
    ContentType: contentType,
  }));
  
  return key;
}

export async function getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client as any, command, { expiresIn });
}
