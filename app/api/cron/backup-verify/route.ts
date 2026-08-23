/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { verifySecret } from '@/lib/crypto';
import { db } from '@/drizzle/db';
import { backupRecords, backupAlerts } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { Pool } from 'pg';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { alertSuperAdmin } from '@/lib/email/service';

/**
 * POST /api/cron/backup-verify
 *
 * Scheduled after each nightly backup (or weekly — cadence is the scheduler's
 * concern). Proves that the most recent backup is:
 *
 *   1. LOCATABLE — the artefact file/object actually exists.
 *   2. INTACT    — its sha256 matches the digest recorded at creation time.
 *   3. RESTORABLE — pg_restore into a scratch database succeeds.
 *   4. USEFUL    — the restored database contains a non-zero number of tables
 *      and, for a full backup, non-zero rows in a known table.
 *
 * Results are persisted in backup_records.last_verified_at / verified_ok so
 * the health endpoint and dashboard can report DR readiness.
 *
 * On failure, an alert is created and the super-admin is emailed — because a
 * backup that cannot restore is not a backup.
 *
 * THIS IS THE MISSING PIECE: the backup existed, the health check confirmed it
 * was recent, but nothing ever proved it could actually be used. An untested
 * backup is a guess; this makes it evidence.
 */

function checksumFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr: stderr.slice(0, 2000) }));
  });
}

const MAX_VERIFY_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB safety limit

async function fetchFromS3(storagePath: string, destDir: string): Promise<string> {
  const { getS3Config } = await import('@/lib/storage/s3-config');
  const cfg = getS3Config();
  if (!cfg.configured || !cfg.backupBucket) {
    throw new Error('Backup is stored off-site but S3/MinIO is not configured');
  }
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: cfg.credentials,
  });
  const res = await client.send(
    new GetObjectCommand({ Bucket: cfg.backupBucket, Key: storagePath })
  );
  if (!res.Body) throw new Error(`Empty body for ${storagePath}`);
  const stream = res.Body as import('stream').Readable;
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_VERIFY_SIZE_BYTES) {
      throw new Error(
        `Backup file exceeded ${MAX_VERIFY_SIZE_BYTES / (1024 * 1024)} MB limit during verify download. Aborting.`
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  const dest = path.join(destDir, path.basename(storagePath));
  const { writeFile } = await import('fs/promises');
  await writeFile(dest, Buffer.concat(chunks));
  return dest;
}

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!verifySecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 });
  }

  const failures: string[] = [];
  let workDir: string | null = null;
  let scratchDb: string | null = null;
  const mainPool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    // Find the most recent completed backup.
    const [backup] = await db
      .select()
      .from(backupRecords)
      .where(eq(backupRecords.status, 'completed'))
      .orderBy(desc(backupRecords.completedAt))
      .limit(1);

    if (!backup) {
      failures.push('No completed backup exists to verify');
      throw new Error('no backup');
    }
    if (!backup.storagePath) {
      failures.push('Backup record has no storage_path — artefact is unlocatable');
      throw new Error('no path');
    }

    workDir = mkdtempSync(path.join(tmpdir(), 'nucrm-bkv-'));

    // ── 1. Locate ────────────────────────────────────────────────────────────
    let localFile: string;
    if (backup.storageType === 'local') {
      if (!existsSync(backup.storagePath)) {
        failures.push(
          `Local-only backup file missing at ${backup.storagePath}. ` +
          'It does not survive a container restart.'
        );
        throw new Error('file missing');
      }
      localFile = backup.storagePath;
    } else {
      localFile = await fetchFromS3(backup.storagePath, workDir);
    }

    // ── 2. Integrity ─────────────────────────────────────────────────────────
    const actual = await checksumFile(localFile);
    if (backup.checksum && backup.checksum.toLowerCase() !== actual.toLowerCase()) {
      failures.push(
        `Checksum mismatch: recorded ${backup.checksum}, actual ${actual}. ` +
        'Artefact is corrupt or truncated.'
      );
      // Don't throw yet — record the integrity failure and try restoring anyway
      // so both signals land in the alert.
    }

    // ── 2b. Decrypt if encrypted ─────────────────────────────────────────────
    // #866 added AES-256-GCM encryption; encrypted artefacts carry a .enc
    // extension. pg_restore/psql need plaintext, so decrypt before step 3.
    //
    // Ordering matters, and it has to be *after* the checksum above. The
    // checksum in backup_records is computed over the encrypted artefact —
    // backup-service.ts encrypts at L121 and checksums the result at L129 —
    // so hashing the decrypted file would compare a plaintext digest against a
    // ciphertext digest and report every encrypted backup as corrupt. That would
    // be a false alarm from the very job meant to detect real corruption.
    if (localFile.endsWith('.enc')) {
      const { decryptBackupFile, isEncryptionEnabled } = await import('@/lib/backups/encrypt');
      if (!isEncryptionEnabled()) {
        failures.push(
          'Backup is encrypted (.enc) but BACKUP_ENCRYPTION_KEY is not configured. ' +
          'Cannot verify — the key is required to decrypt before restore.'
        );
        throw new Error('encryption key missing');
      }
      const decryptedPath = localFile.replace(/\.enc$/, '');
      await decryptBackupFile(localFile, decryptedPath);
      localFile = decryptedPath;
    }

    // ── 3. Restore into scratch database ─────────────────────────────────────
    scratchDb = `nucrm_verify_${Date.now()}`;
    if (!/^[a-z0-9_]+$/.test(scratchDb)) {
      throw new Error(`Unsafe scratch database name: ${scratchDb}`);
    }
    const scratchUrl = new URL(databaseUrl);
    scratchUrl.pathname = `/${scratchDb}`;

    await mainPool.query(`CREATE DATABASE "${scratchDb}"`);

    const isPlainSql = backup.backupType === 'selective' || localFile.endsWith('.sql');
    const restore = isPlainSql
      ? await run('psql', [scratchUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-f', localFile])
      : await run('pg_restore', ['--no-owner', '--no-acl', '-d', scratchUrl.toString(), localFile]);

    if (restore.code !== 0) {
      failures.push(`Restore failed (exit ${restore.code}): ${restore.stderr.slice(0, 500)}`);
    }

    // ── 4. Validate content ──────────────────────────────────────────────────
    const scratchPool = new Pool({ connectionString: scratchUrl.toString(), max: 1 });
    try {
      const tables = await scratchPool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      );
      const tableCount = parseInt(tables.rows[0]?.count ?? '0', 10);
      if (tableCount === 0) {
        failures.push('Restored database contains zero tables');
      }

      if (backup.backupType !== 'schema' && tableCount > 0) {
        const tenants = await scratchPool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM tenants`
        ).catch(() => null);
        if (tenants && parseInt(tenants.rows[0]?.count ?? '0', 10) === 0) {
          failures.push('Restored database has zero tenants — backup may be schema-only despite being marked full');
        }
      }
    } finally {
      await scratchPool.end();
    }

    // ── Persist result ───────────────────────────────────────────────────────
    const verifiedOk = failures.length === 0;
    await db
      .update(backupRecords)
      .set({
        lastVerifiedAt: new Date(),
        verifiedOk,
        verifyError: verifiedOk ? null : failures.join('; '),
        updatedAt: new Date(),
      })
      .where(eq(backupRecords.id, backup.id));

    if (!verifiedOk) {
      await db.insert(backupAlerts).values({
        alertType: 'verify_failed',
        message: failures.join(' | '),
      });
      await alertSuperAdmin(
        'CRITICAL: Backup verification FAILED',
        `Backup ${backup.id} (${backup.backupType}, ${backup.completedAt?.toISOString()}) failed verification:\n\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        '\n\nAn unrestorable backup is not a backup. Investigate immediately.'
      ).catch(() => { /* best-effort */ });
    }

    return NextResponse.json({
      ok: verifiedOk,
      backup_id: backup.id,
      backup_type: backup.backupType,
      completed_at: backup.completedAt,
      checksum_match: !backup.checksum || backup.checksum.toLowerCase() === actual.toLowerCase(),
      ...(failures.length > 0 ? { failures } : {}),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (failures.length > 0) {
      // We have specific diagnostics — return them even on a throw.
      await db.insert(backupAlerts).values({
        alertType: 'verify_failed',
        message: failures.join(' | '),
      }).catch(() => {});
      await alertSuperAdmin(
        'CRITICAL: Backup verification FAILED',
        failures.map((f) => `  - ${f}`).join('\n')
      ).catch(() => {});
      return NextResponse.json({ ok: false, failures }, { status: 500 });
    }
    return apiError(err);
  } finally {
    // Always clean up the scratch database.
    if (scratchDb) {
      await mainPool.query(`DROP DATABASE IF EXISTS "${scratchDb}" WITH (FORCE)`).catch(async () => {
        await mainPool.query(`DROP DATABASE IF EXISTS "${scratchDb}"`).catch(() => {});
      });
    }
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    await mainPool.end();
  }
}
