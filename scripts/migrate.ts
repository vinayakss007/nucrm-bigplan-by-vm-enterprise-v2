#!/usr/bin/env node
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';
import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';
import { pgSslConfig } from '../lib/db/ssl-config';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isYes = args.includes('--yes') || args.includes('-y');

function detectEnv(url: string): string {
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';
  if (url.includes('staging') || url.includes('dev.')) return 'staging';
  if (url.includes('prod') || url.includes('production')) return 'production';
  return 'unknown';
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  if (databaseUrl.includes('dev-jwt-secret') || databaseUrl.includes('change-in-production')) {
    console.error('ERROR: Weak/dev credentials detected. Set strong secrets before migrating.');
    process.exit(1);
  }

  const env = detectEnv(databaseUrl);
  console.log(`[migrate] Target database environment: ${env}`);

  const journalPath = path.resolve('./drizzle/migrations/meta/_journal.json');
  if (!fs.existsSync(journalPath)) {
    console.error('ERROR: Migration journal not found at', journalPath);
    process.exit(1);
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const pendingCount = journal.entries.length;

  if (pendingCount === 0) {
    console.log('[migrate] No pending migrations.');
    process.exit(0);
  }

  console.log(`[migrate] ${pendingCount} pending migration(s):`);
  for (const entry of journal.entries) {
    console.log(`  - ${entry.tag}`);
  }

  if (isDryRun) {
    console.log('[migrate] Dry-run complete. No migrations applied.');
    process.exit(0);
  }

  if (!isYes) {
    const ok = await confirm(`Apply ${pendingCount} migration(s) to the "${env}" database? (y/N)`);
    if (!ok) {
      console.log('[migrate] Aborted by user.');
      process.exit(0);
    }
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: pgSslConfig(),
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  console.log('[migrate] Connecting to database...');

  // Acquire advisory lock to prevent concurrent migration execution.
  // Without this, two `npm run db:migrate` processes (e.g. CI + manual)
  // can apply the same migrations simultaneously, corrupting the schema.
  //
  // Scope: this guards `db:migrate` only. `db:sync` (drizzle-kit push, which is what
  // ci.yml actually runs) and scripts/rollback-migration.ts do not take this lock.
  const MIGRATION_LOCK_KEY = 123456789; // Stable key shared by all db:migrate runs
  const lockClient = await pool.connect();
  try {
    // Block rather than fail fast, so an overlapping run queues instead of breaking
    // the pipeline -- but stay bounded: lock_timeout caps how long we wait.
    await lockClient.query(`SET lock_timeout = '30000ms'`);
    await lockClient.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_KEY]);
    console.log('[migrate] Advisory lock acquired — no other migration can run concurrently.');
  } catch (lockErr) {
    // 55P03 lock_not_available: someone else held the lock for longer than lock_timeout.
    if ((lockErr as { code?: string } | null)?.code === '55P03') {
      console.error('[migrate] ERROR: Another migration is still running after 30s (advisory lock held).');
      console.error('[migrate] Wait for it to finish or check for stuck connections.');
    } else {
      console.error('[migrate] Failed to acquire advisory lock:', lockErr);
    }
    lockClient.release();
    await pool.end();
    process.exit(1);
  }

  // The ledger drizzle's migrate() actually consults is "drizzle"."__drizzle_migrations".
  //
  // This recovery block used to create and seed an UNQUALIFIED
  // "__drizzle_migrations", which lands in `public` — a table drizzle never
  // reads. So on a database provisioned with db:push/db:sync (schema already
  // present, no ledger), recovery reported success, seeded 40 rows into
  // public, and then migrate() found ITS ledger empty and tried to replay every
  // migration from 0000_init over the live schema. Verified against PostgreSQL
  // 16: `public = 40, drizzle = 0`, then `42P07 relation already exists` and a
  // non-zero exit. Data survived only because the first failing statement
  // happened to be a CREATE TABLE; a migration opening with ALTER or DROP would
  // have damaged it.
  //
  // drizzle decides what is outstanding by comparing each migration's
  // folderMillis against the newest `created_at` in that table — not by hash —
  // so seeding the journal's `when` values is enough to mark them applied.
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "drizzle";`));
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `));

  const count = await db.execute<{ cnt: string }>(
    sql.raw(`SELECT COUNT(*)::text AS cnt FROM "drizzle"."__drizzle_migrations"`),
  );
  const rowCount = parseInt(count.rows[0].cnt, 10);

  if (rowCount === 0 && journal.entries.length > 0) {
    const schemaExists = await db.execute<{ exists: boolean }>(
      sql.raw(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'api_key_usage')`),
    );

    // Marker for the LAST migration in the journal (0044_backup_verification
    // adds last_verified_at to backup_records). Checking only an early marker
    // (api_key_usage is created by 0016/0017) let a DB that was pushed at
    // ~0038 get stamped as fully migrated, permanently cementing schema drift
    // (verified on the prod VM: contacts.team_id from 0041 was missing and
    // contact creation failed with "column team_id does not exist").
    const lastEntry = journal.entries[journal.entries.length - 1]!;
    const lastMigrationApplied = await db.execute<{ exists: boolean }>(
      sql.raw(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_name = 'backup_records' AND column_name = 'last_verified_at'
        )
      `),
    );

    if (schemaExists.rows[0].exists && lastMigrationApplied.rows[0].exists) {
      console.log('[migrate] Recovery: schema already exists but the migration ledger is empty.');
      console.log('[migrate] This database was provisioned with db:push/db:sync or restored');
      console.log('[migrate] from a dump. Stamping the journal as applied rather than replaying');
      console.log(`[migrate] it over live tables. Seeding ${journal.entries.length} entries...`);
      for (const entry of journal.entries) {
        await db.execute(
          sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
              VALUES (${entry.tag}, ${entry.when})`,
        );
      }
      console.log('[migrate] Recovery complete — no migration SQL was executed.');
    } else if (schemaExists.rows[0].exists && !lastMigrationApplied.rows[0].exists) {
      // Partial schema: the ledger is empty but the schema is NOT at the last
      // migration's state. Stamping everything would permanently hide the
      // drift; replaying from 0000_init would replay the entire history over
      // live tables. Either way risks data loss — refuse and ask for action.
      console.error('[migrate] ERROR: Database has schema but it is NOT at the latest migration state.');
      console.error(`[migrate] Ledger is empty but marker for the last migration (${lastEntry.tag}) is missing.`);
      console.error('[migrate] This is usually a partial push/restore. Options:');
      console.error('[migrate]   1. Run the remaining migrations manually and re-run db:migrate.');
      console.error('[migrate]   2. Restore from a full backup.');
      console.error('[migrate]   3. If the schema really is current, contact the maintainers.');
      process.exit(1);
    } else {
      console.log('[migrate] Fresh database detected. Running all migrations...');
    }
  }

  console.log('[migrate] Applying pending migrations with drizzle-orm migrator...');
  await migrate(db, { migrationsFolder: './drizzle/migrations' });

  console.log('[migrate] All migrations applied successfully');

  // Release advisory lock
  try {
    await lockClient.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
    console.log('[migrate] Advisory lock released.');
  } catch {
    // Lock auto-releases on disconnect anyway
  }
  lockClient.release();
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
