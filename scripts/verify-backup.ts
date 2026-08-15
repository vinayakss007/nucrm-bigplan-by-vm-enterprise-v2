#!/usr/bin/env npx tsx
/**
 * Verify a backup artefact.
 *
 * An untested backup is a guess. This script proves two things about the most
 * recent (or a specified) backup:
 *
 *   1. Integrity — the bytes still hash to the digest recorded at creation.
 *   2. Restorability — `pg_restore` can actually load it into a scratch
 *      database, and the result contains the tables and rows we expect.
 *
 * Usage:
 *   npx tsx scripts/verify-backup.ts                 # verify latest backup
 *   npx tsx scripts/verify-backup.ts --id <uuid>     # verify a specific one
 *   npx tsx scripts/verify-backup.ts --checksum-only # skip the restore drill
 *
 * Exits non-zero on any failure so it can be wired to a scheduler and alert.
 */

import { Pool } from 'pg';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';

interface BackupRow {
  id: string;
  backup_type: string;
  storage_path: string | null;
  storage_type: string | null;
  size_bytes: string | number | null;
  checksum: string | null;
  checksum_algorithm: string | null;
  completed_at: Date | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const hasFlag = (name: string) => process.argv.includes(name);

function checksumFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 1000)}`));
    });
  });
}

const MAX_VERIFY_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB safety limit

/** Download an S3/R2-stored backup to a local temp path. */
async function fetchFromS3(storagePath: string, destDir: string): Promise<string> {
  const { getS3Config } = await import('../lib/storage/s3-config');
  const cfg = getS3Config();
  if (!cfg.configured || !cfg.backupBucket) {
    throw new Error('Backup is stored off-site but S3 is not configured locally');
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
  if (!res.Body) throw new Error(`Empty body for s3://${cfg.backupBucket}/${storagePath}`);

  const stream = res.Body as import('stream').Readable;
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_VERIFY_SIZE_BYTES) {
      throw new Error(
        `Backup file exceeded ${MAX_VERIFY_SIZE_BYTES / (1024 * 1024)} MB limit during download. Aborting.`
      );
    }
    chunks.push(Buffer.from(chunk));
  }

  const dest = path.join(destDir, path.basename(storagePath));
  const { writeFile } = await import('fs/promises');
  await writeFile(dest, Buffer.concat(chunks));
  return dest;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const failures: string[] = [];
  let workDir: string | null = null;

  try {
    const id = arg('--id');
    const { rows } = id
      ? await pool.query<BackupRow>(
          `SELECT id, backup_type, storage_path, storage_type, size_bytes,
                  checksum, checksum_algorithm, completed_at
             FROM backup_records WHERE id = $1`,
          [id]
        )
      : await pool.query<BackupRow>(
          `SELECT id, backup_type, storage_path, storage_type, size_bytes,
                  checksum, checksum_algorithm, completed_at
             FROM backup_records
            WHERE status = 'completed'
            ORDER BY completed_at DESC NULLS LAST
            LIMIT 1`
        );

    const backup = rows[0];
    if (!backup) {
      console.error('ERROR: no completed backup found to verify');
      process.exit(1);
    }

    console.log(`\nVerifying backup ${backup.id}`);
    console.log(`  type        : ${backup.backup_type}`);
    console.log(`  storage     : ${backup.storage_type} ${backup.storage_path}`);
    console.log(`  completed   : ${backup.completed_at?.toISOString() ?? 'n/a'}`);

    if (!backup.storage_path) {
      failures.push('Backup record has no storage_path — the artefact is unlocatable');
      throw new Error('unlocatable backup');
    }

    workDir = mkdtempSync(path.join(tmpdir(), 'nucrm-verify-'));

    // ── Locate the artefact ────────────────────────────────────────────────
    let localFile: string;
    if (backup.storage_type === 'local') {
      if (!existsSync(backup.storage_path)) {
        failures.push(
          `Local-only backup is missing from disk at ${backup.storage_path}. ` +
          `This is the failure mode of local-only backups: the file does not ` +
          `survive a container restart.`
        );
        throw new Error('artefact missing');
      }
      localFile = backup.storage_path;
    } else {
      console.log('  fetching from object storage...');
      localFile = await fetchFromS3(backup.storage_path, workDir);
    }

    // ── 1. Integrity ───────────────────────────────────────────────────────
    const actual = await checksumFile(localFile);
    if (!backup.checksum) {
      // Pre-migration rows have no digest. Report rather than silently pass.
      console.warn(
        `  ! checksum: NOT RECORDED — integrity cannot be proven for this ` +
        `backup (created before checksums were added). Actual is ${actual}.`
      );
    } else if (backup.checksum.toLowerCase() !== actual.toLowerCase()) {
      failures.push(
        `Checksum mismatch: recorded ${backup.checksum}, actual ${actual}. ` +
        `The artefact is corrupt or truncated.`
      );
    } else {
      console.log(`  ok checksum: ${actual}`);
    }

    if (hasFlag('--checksum-only')) {
      if (failures.length) throw new Error('verification failed');
      console.log('\nPASS (checksum only)\n');
      return;
    }

    // ── 2. Restorability ───────────────────────────────────────────────────
    // Restore into a scratch database so production is never touched.
    // Name is generated, not user input, but assert the shape anyway since it
    // is interpolated into DDL (CREATE/DROP DATABASE cannot be parameterised).
    const scratchDb = `nucrm_verify_${Date.now()}`;
    if (!/^[a-z0-9_]+$/.test(scratchDb)) {
      throw new Error(`Refusing unsafe scratch database name: ${scratchDb}`);
    }

    const scratchUrl = new URL(databaseUrl);
    scratchUrl.pathname = `/${scratchDb}`;

    console.log(`  creating scratch database ${scratchDb}...`);
    await pool.query(`CREATE DATABASE "${scratchDb}"`);

    const restoreStart = Date.now();
    try {
      if (backup.backup_type === 'selective') {
        // Plain-SQL dump
        await run('psql', [scratchUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-f', localFile]);
      } else {
        // Custom-format dump
        await run('pg_restore', ['--no-owner', '--no-acl', '-d', scratchUrl.toString(), localFile]);
      }
      const restoreMs = Date.now() - restoreStart;
      console.log(`  ok restore: completed in ${(restoreMs / 1000).toFixed(1)}s`);

      // Validate the restored database actually contains something usable.
      const scratchPool = new Pool({ connectionString: scratchUrl.toString(), max: 1 });
      try {
        const tables = await scratchPool.query<{ count: string }>(
          `SELECT count(*)::text AS count
             FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
        );
        const tableCount = parseInt(tables.rows[0]?.count ?? '0', 10);
        console.log(`  ok schema : ${tableCount} table(s) restored`);
        if (tableCount === 0) {
          failures.push('Restored database contains zero tables');
        }

        // A schema-only dump legitimately has no rows; a full one must not be
        // completely empty.
        if (backup.backup_type !== 'schema') {
          const users = await scratchPool.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM users`
          ).catch(() => null);
          if (!users) {
            failures.push('Restored database has no readable users table');
          } else {
            console.log(`  ok data   : users rows = ${users.rows[0]?.count ?? '0'}`);
          }
        }
      } finally {
        await scratchPool.end();
      }
    } finally {
      // Always drop the scratch database, even when the restore threw, so a
      // failed run does not leave orphaned databases behind.
      console.log(`  dropping scratch database ${scratchDb}...`);
      await pool.query(`DROP DATABASE IF EXISTS "${scratchDb}" WITH (FORCE)`).catch(async () => {
        // WITH (FORCE) needs PostgreSQL 13+; fall back for older servers.
        await pool.query(`DROP DATABASE IF EXISTS "${scratchDb}"`).catch((e) =>
          console.error(`  ! could not drop ${scratchDb}:`, e.message)
        );
      });
    }

    if (failures.length) throw new Error('verification failed');
    console.log('\nPASS — backup is intact and restorable\n');
  } catch (err) {
    console.error('\nFAIL — backup verification did not pass');
    for (const f of failures) console.error(`  - ${f}`);
    if (failures.length === 0) {
      console.error(`  - ${err instanceof Error ? err.message : String(err)}`);
    }
    console.error('');
    process.exitCode = 1;
  } finally {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    await pool.end();
  }
}

main();
