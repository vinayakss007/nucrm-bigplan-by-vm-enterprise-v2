import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { backupRecords, backupAlerts, errorLogs } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { alertSuperAdmin } from '@/lib/email/service';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { spawn } from 'child_process';
import { checkDirExists, ensureDir, deleteFile, getFileStats } from '@/lib/backups/runtime-fs';

const exec = promisify(execCb);

/**
 * Safely run pg_dump with input validation.
 * All parameters are validated against allowlists to prevent command injection.
 * 
 * Supports two formats:
 * - 'full' | 'schema' → custom format (binary, compressed, for pg_restore)
 * - 'selective' → plain SQL with INSERTs (for selective tenant restore)
 */
async function runPgDump(backupType: 'full' | 'schema' | 'selective', outputPath: string): Promise<void> {
  // Validate DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://'))) {
    throw new Error('Invalid DATABASE_URL format');
  }

  // Validate backup type
  if (!['full', 'schema', 'selective'].includes(backupType)) {
    throw new Error('Invalid backup type');
  }

  // Validate output path - must be a safe absolute path
  if (!outputPath.startsWith('/tmp/') && !outputPath.startsWith(process.env.BACKUP_LOCAL_DIR || '/invalid')) {
    throw new Error('Invalid output path');
  }

  const args = [
    dbUrl,
    '--no-owner',
    '--no-acl',
    '-f', outputPath,
  ];

  if (backupType === 'schema') {
    // Custom format with schema only
    args.push('--format=custom', '--compress=9', '--schema-only');
  } else if (backupType === 'selective') {
    // Plain SQL with INSERTs — parseable by backup-parser.ts
    args.push('--inserts', '--no-comments');
  } else {
    // 'full' — custom format for fast pg_restore
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

/**
 * Safely run pg_dump --version
 */
async function getPgDumpVersion(): Promise<string> {
  try {
    const { stdout } = await exec('pg_dump --version');
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

// Called daily by cron — runs pg_dump, uploads to S3/R2 or keeps local
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!verifySecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const backupType = new URL(request.url).searchParams.get('type') || 'full';
  const t0 = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // Use correct extension for format: .dump for custom, .sql for INSERT format
  const extension = backupType === 'selective' ? '.sql' : '.dump';
  const filename = `nucrm_${backupType}_${timestamp}${extension}`;
  const localDir = process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups';
  const localPath = `${localDir}/${filename}`;

  // Create backup record
  const [backup] = await db.insert(backupRecords).values({
    backupType: backupType as any,
    status: 'running',
    initiatedAuto: true,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  }).returning();

  if (!backup) {
    return NextResponse.json({ error: 'Failed to create backup record' }, { status: 500 });
  }

  try {
    // Ensure local backup dir exists
    await ensureDir(localDir);

    // Run pg_dump with safe parameterized execution
    await runPgDump(backupType as 'full' | 'schema' | 'selective', localPath);

    const stats = await getFileStats(localPath);
    const sizeBytes = stats?.size || 0;
    const durationMs = Date.now() - t0;

    let storagePath = localPath;
    let storageType = 'local';

    // Upload to S3/R2 if configured
    if (process.env.BACKUP_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
        const { readFile } = await import('fs/promises');

        const s3Client = new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
          endpoint: process.env.AWS_ENDPOINT_URL || undefined,
        });

        const fileContent = await readFile(localPath);
        const s3Key = `backups/${filename}`;

        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.BACKUP_BUCKET,
          Key: s3Key,
          Body: fileContent,
          StorageClass: 'STANDARD_IA',
        }));

        storagePath = s3Key;
        storageType = process.env.AWS_ENDPOINT_URL?.includes('r2') ? 's3_r2' : 's3';

        // Delete local after successful upload
        await deleteFile(localPath);

        // Purge old S3 backups beyond retention
        const retention = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
        const cutoff = new Date(Date.now() - retention * 86400000);

        const listResp = await s3Client.send(new ListObjectsV2Command({
          Bucket: process.env.BACKUP_BUCKET,
          Prefix: 'backups/',
        }));

        const oldKeys = (listResp.Contents || [])
          .filter(obj => obj.LastModified && obj.LastModified < cutoff && obj.Key)
          .map(obj => ({ Key: obj.Key! }));

        if (oldKeys.length > 0) {
          await s3Client.send(new DeleteObjectsCommand({
            Bucket: process.env.BACKUP_BUCKET,
            Delete: { Objects: oldKeys },
          })).catch(() => {});
        }
      } catch (uploadErr: any) {
        console.error('[backup] S3 upload failed, keeping local:', uploadErr.message);
        storageType = 'local';
      }
    }

    // Mark completed
    await db.update(backupRecords)
      .set({
        status: 'completed',
        sizeBytes: sizeBytes,
        storagePath: storagePath,
        storageType: storageType,
        durationMs: durationMs,
        completedAt: new Date(),
        metadata: {
          pg_version: await getPgDumpVersion(),
          backup_type: backupType
        }
      })
      .where(eq(backupRecords.id, backup.id));

    // Clear any backup alerts
    await db.update(backupAlerts)
      .set({
        resolved: true,
        resolvedAt: new Date()
      })
      .where(and(
        eq(backupAlerts.alertType, 'no_backup'),
        eq(backupAlerts.resolved, false)
      )).catch(() => {});

    console.log(`[backup] completed: ${filename} (${(sizeBytes / 1024 / 1024).toFixed(1)}MB, ${durationMs}ms)`);
    return NextResponse.json({
      ok: true, filename, size_bytes: sizeBytes, duration_ms: durationMs, storage: storageType,
    });

  } catch (err: any) {
    const durationMs = Date.now() - t0;
    console.error('[backup] FAILED:', err.message);

    await db.update(backupRecords)
      .set({
        status: 'failed',
        errorMessage: err.message.slice(0, 500),
        durationMs: durationMs
      })
      .where(eq(backupRecords.id, backup.id));

    // Log to error_logs
    await db.insert(errorLogs).values({
      level: 'fatal',
      code: 'BACKUP_FAILED',
      message: `Automated backup failed: ${err.message}`,
      stack: err.stack?.slice(0, 2000)
    }).catch(() => {});

    // Alert super admin
    await alertSuperAdmin(
      'CRITICAL: Automated Database Backup FAILED',
      `Time: ${new Date().toISOString()}\nError: ${err.message}\n\nManual backup required immediately:\n1. Check database connection\n2. Check disk space\n3. Run backup manually from superadmin console`
    ).catch(() => {});

    return apiError(err);
  }
}
