import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { backupRecords, errorLogs } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { spawn } from 'child_process';
import { downloadFromS3, checkFileExists, deleteFile } from '@/lib/restore/runtime-fs';
import { logError } from '@/lib/errors-server';

/**
 * Safely run pg_restore with input validation.
 * All parameters are validated to prevent command injection.
 */
async function runPgRestore(inputPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://'))) {
    throw new Error('Invalid DATABASE_URL format');
  }

  if (!checkFileExists(inputPath)) {
    throw new Error(`Backup file not found: ${inputPath}`);
  }

  // Validate path is in allowed directories
  const allowedDirs = ['/tmp', process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups'];
  const isAllowed = allowedDirs.some(dir => inputPath.startsWith(dir));
  if (!isAllowed) {
    throw new Error('Restore path not in allowed directories');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('pg_restore', [
      `--dbname=${dbUrl}`,
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      inputPath,
    ], {
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore failed with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

// GET: list available backups for restore
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const backups = await db
      .select({
        id: backupRecords.id,
        backupType: backupRecords.backupType,
        status: backupRecords.status,
        sizeBytes: backupRecords.sizeBytes,
        storagePath: backupRecords.storagePath,
        storageType: backupRecords.storageType,
        durationMs: backupRecords.durationMs,
        createdAt: backupRecords.createdAt,
        completedAt: backupRecords.completedAt,
        expiresAt: backupRecords.expiresAt,
        metadata: backupRecords.metadata,
      })
      .from(backupRecords)
      .where(eq(backupRecords.status, 'completed'))
      .orderBy(desc(backupRecords.completedAt))
      .limit(30);

    return NextResponse.json({ data: backups });
  } catch (err: any) {
    console.error('[superadmin/restore GET]', err);
    return apiError(err);
  }
}

const restoreSchema = z.object({
  backup_id: z.string().min(1),
  confirm_restore: z.boolean(),
});

// POST: restore from a specific backup
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const body = await request.json();
    const validated = validateBody(restoreSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { backup_id, confirm_restore } = validated.data;

    const [backup] = await db
      .select()
      .from(backupRecords)
      .where(and(eq(backupRecords.id, backup_id), eq(backupRecords.status, 'completed')))
      .limit(1);

    if (!backup) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });

    const t0 = Date.now();

    // Log the restore attempt
    await db.insert(errorLogs).values({
      level: 'warn',
      code: 'RESTORE_INITIATED',
      message: `Database restore initiated from backup: ${backup.storagePath} by user ${ctx.userId}`,
    }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    let localPath = backup.storagePath;
    let tempFileCreated = false;

    // Download from S3 if needed
    if (['s3', 's3_r2'].includes(backup.storageType ?? '')) {
      localPath = await downloadFromS3({ storagePath: backup.storagePath!, id: backup.id }, {
        bucket: process.env.BACKUP_BUCKET || '',
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT_URL,
      });
      tempFileCreated = true;
    }

    if (!localPath || !(await checkFileExists(localPath))) {
      return NextResponse.json({ error: `Backup file not found: ${localPath}` }, { status: 404 });
    }

    // Restore using pg_restore with safe parameterized execution
    await runPgRestore(localPath);

    // Cleanup temp file
    if (tempFileCreated) {
      await deleteFile(localPath);
    }

    const durationMs = Date.now() - t0;

    // Log success
    await db.insert(errorLogs).values({
      level: 'info',
      code: 'RESTORE_COMPLETED',
      message: `Database restore completed from ${backup.storagePath} in ${durationMs}ms`,
    }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    return NextResponse.json({
      ok: true,
      message: `Database restored from backup: ${backup.storagePath}`,
      duration_ms: durationMs,
    });
  } catch (err: any) {
    console.error('[restore POST]', err);
    await db.insert(errorLogs).values({
      level: 'fatal',
      code: 'RESTORE_FAILED',
      message: "Internal server error",
      stack: err.stack?.slice(0, 2000),
    }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    return apiError(err);
  }
}

