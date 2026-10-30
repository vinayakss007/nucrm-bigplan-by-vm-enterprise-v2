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
 * The drill connects as BACKUP_DATABASE_URL when it is set (the role the dump was
 * taken with), else DATABASE_URL. Only the former can `CREATE DATABASE` and read a
 * FORCE-RLS dump back, so a hardened host must set it — see #3255.
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
import { pgLibpqEnv } from '../lib/backups/backup-service';
import { pgSslConfig } from '../lib/db/ssl-config';

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

export async function main() {
  // Same precedence as the dump: `pg_dump` runs under BACKUP_DATABASE_URL, so a
  // verification that read the app URL would restore a backup taken by a role it
  // cannot become — and the drill only ever passed on a host that had not done
  // the least-privilege cutover (#3255).
  const databaseUrl = process.env.BACKUP_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: BACKUP_DATABASE_URL (preferred) or DATABASE_URL is required');
    process.exit(1);
  }

  // #3256: `ssl` is the only TLS channel node-pg has. It does not read
  // `?sslmode=` from the URL — libpq does, and libpq is what the psql /
  // pg_restore child below speaks (via pgLibpqEnv). Omitting it here meant
  // that once pg_hba.conf says `hostssl`, the restore succeeded and the
  // validation query on this pool died with `no pg_hba.conf entry for host
  // … (required no encryption)`, reporting FAIL for a dump that restores fine.
  // One policy for every connection in the repo: see lib/db/ssl-config.ts.
  const pool = new Pool({ connectionString: databaseUrl, ssl: pgSslConfig(), max: 1 });
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
    // Credentials reach psql/pg_restore through the libpq PG* environment
    // variables, never as a positional connection string: argv is world-
    // readable via `ps aux` and /proc/<pid>/cmdline, and this job runs with a
    // BYPASSRLS role on a host shared by several containers (#3260). The helper
    // is the one `pg_dump` uses in lib/backups/backup-service.ts.
    // The scratch database name itself is still passed to the child — it is a
    // generated, already-logged identifier, not a secret, and both tools need
    // it explicitly: `pg_restore` aborts with "one of -d/--dbname and -f/--file
    // must be specified" rather than reading PGDATABASE (verified against the
    // installed pg_restore 16 man page and by running it), and naming the target
    // removes any dependence on psql's default-database rules.
    const restoreEnv = pgLibpqEnv(scratchUrl.toString());
    try {
      if (backup.backup_type === 'selective') {
        // Plain-SQL dump
        await run('psql', [scratchDb, '-v', 'ON_ERROR_STOP=1', '-f', localFile], restoreEnv);
      } else {
        // Custom-format dump
        await run('pg_restore', ['--no-owner', '--no-acl', '-d', scratchDb, localFile], restoreEnv);
      }
      const restoreMs = Date.now() - restoreStart;
      console.log(`  ok restore: completed in ${(restoreMs / 1000).toFixed(1)}s`);

      // Validate the restored database actually contains something usable.
      // #3256: the same policy as the source pool above — this one is the pool
      // that runs the query the incident actually killed.
      const scratchPool = new Pool({ connectionString: scratchUrl.toString(), ssl: pgSslConfig(), max: 1 });
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
          // FORCE RLS travels with the dump, so an unarmed `count(*) FROM users`
          // reads 0 on a database that is full of rows. Arm the platform context
          // and label the number with the context it was read in (#3280).
          const client = await scratchPool.connect();
          try {
            await client.query('BEGIN READ ONLY');
            await client.query(`SELECT set_config('app.is_super_admin', 'true', true)`);
            const users = await client.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM users`
            );
            await client.query('ROLLBACK');
            console.log(`  ok data   : ${users.rows[0]?.count ?? '0'} users row(s), counted with app.is_super_admin=true`);
          } catch {
            await client.query('ROLLBACK').catch(() => undefined);
            failures.push('Restored database has no readable users table');
          } finally {
            client.release();
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

// Guarded so `tests/unit/verify-backup-argv-3260.test.ts` can import `main()`
// without the module opening a database connection on load — the same shape as
// `scripts/drift-check.ts:476` and `scripts/migrate-fresh.ts:632`.
if (/[/\\]scripts[/\\]verify-backup\.ts$/.test(process.argv[1] ?? '')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
