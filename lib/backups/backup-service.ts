import { db } from '@/drizzle/db';
import { backupRecords } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { spawn, exec as execCb } from 'child_process';
import { promisify } from 'util';

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
}

async function getPgDumpVersion(): Promise<string> {
  try {
    const { stdout } = await exec('pg_dump --version');
    return stdout.trim();
  } catch (e) {
    console.error('[Backup] Backup failed:', e);
    return 'Backup failed: ' + (e instanceof Error ? e.message : String(e));
  }
}

export async function runPgDump(backupType: string, outputPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://'))) {
    throw new Error('Invalid DATABASE_URL format');
  }

  const args = [
    dbUrl,
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

    const sizeBytes = fs.statSync(localPath).size;
    const durationMs = Date.now() - t0;

    let storagePath = localPath;
    let storageType = 'local';

    // Upload to S3 if configured
    if (process.env.BACKUP_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        
        const s3Client = new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
          endpoint: process.env.AWS_ENDPOINT_URL || undefined,
        });

        const { readFile } = await import('fs/promises');
        const fileContent = await readFile(localPath);
        const s3Key = `backups/${filename}`;

        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.BACKUP_BUCKET,
          Key: s3Key,
          Body: fileContent,
        }));

        storagePath = s3Key;
        storageType = process.env.AWS_ENDPOINT_URL?.includes('r2') ? 's3_r2' : 's3';
        
        // Delete local after successful upload
        fs.unlinkSync(localPath);
      } catch (uploadErr: any) {
        console.error('[backup-service] S3 upload failed, keeping local:', uploadErr.message);
      }
    }

    // Mark completed
    await db.update(backupRecords)
      .set({
        status: 'completed',
        sizeBytes,
        storagePath,
        storageType,
        durationMs,
        completedAt: new Date(),
        metadata: {
          pg_version: await getPgDumpVersion(),
          backup_type: backupType
        }
      })
      .where(eq(backupRecords.id, backup.id));

    return {
      id: backup.id,
      filename,
      localPath,
      sizeBytes,
      durationMs,
      storagePath,
      storageType,
    };

  } catch (err: any) {
    const durationMs = Date.now() - t0;
    await db.update(backupRecords)
      .set({
        status: 'failed',
        errorMessage: err.message.slice(0, 500),
        durationMs
      })
      .where(eq(backupRecords.id, backup.id));
    throw err;
  }
}
