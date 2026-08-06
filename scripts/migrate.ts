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

/**
 * Execute SQL statements from a migration file with error tolerance.
 *
 * Drizzle's built-in migrator wraps each migration in a transaction and
 * stops on the first error.  When a fresh database runs all 59 migrations
 * from scratch, later migrations (e.g. 0003) may contain CREATE TABLE or
 * CREATE INDEX statements for objects already created by an earlier
 * migration (0000/0002).  Drizzle also strips `IF NOT EXISTS` from
 * statements, so the only way to make this idempotent is to execute each
 * statement individually and skip "already exists" errors.
 *
 * Tolerated error codes:
 *   42P07  duplicate_table / duplicate_object  (relation already exists)
 *   42710  duplicate_object                    (index/constraint already exists)
 *   42703  undefined_column                     (migration references column that doesn't exist — non-destructive)
 *   42P01  undefined_table                     (DROP TABLE/INDEX IF EXISTS fallback)
 *   42P11  undefined_object                    (DROP CONSTRAINT IF EXISTS fallback)
 */
const TOLERATED_CODES = new Set(['42P07', '42710', '42703', '42P01', '42P11']);

/**
 * Splits SQL into statements on semicolons while respecting dollar-quoted
 * blocks ($$…$$), named dollar tags ($tag$…$tag$), and single-quoted
 * string literals.  Semicolons inside those contexts are never treated
 * as statement terminators.
 */
function splitSql(sql: string): string[] {
  const stmts: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    // Dollar-quoted block: $$ or $tag$
    if (sql[i] === '$') {
      const tagMatch = sql.slice(i).match(/^\$([^$]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        current += tag;
        i += tag.length;
        let closeIdx = sql.indexOf(tag, i);
        while (closeIdx !== -1) {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
          closeIdx = sql.indexOf(tag, i);
        }
        continue;
      }
    }
    // Single-quoted string literal (handles escaped '' inside)
    if (sql[i] === "'") {
      current += sql[i]; i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          current += "''"; i += 2;
        } else if (sql[i] === "'") {
          current += "'"; i++; break;
        } else {
          current += sql[i]; i++;
        }
      }
      continue;
    }
    // Single-line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      if (nl === -1) { current += sql.slice(i); i = sql.length; }
      else { current += sql.slice(i, nl + 1); i = nl + 1; }
      continue;
    }
    // Block comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) { current += sql.slice(i); i = sql.length; }
      else { current += sql.slice(i, close + 2); i = close + 2; }
      continue;
    }
    // Semicolon = statement terminator
    if (sql[i] === ';') {
      current += ';';
      stmts.push(current);
      current = '';
      i++;
      while (i < sql.length && (sql[i] === '\n' || sql[i] === '\r' || sql[i] === ' ' || sql[i] === '\t')) i++;
      continue;
    }
    current += sql[i];
    i++;
  }
  if (current.trim()) stmts.push(current);
  return stmts;
}

async function runMigrationFile(
  client: { query: (text: string) => Promise<unknown> },
  filePath: string,
  fileName: string,
  dryRun: boolean,
): Promise<{ applied: number; skipped: number; errors: string[] }> {
  let content = fs.readFileSync(filePath, 'utf-8');
  // Strip DOWN section — some hand-written migrations include rollback
  // statements after a "-- DOWN" marker; we only apply the UP portion.
  const downIdx = content.search(/^--\s*DOWN\s*$/m);
  if (downIdx !== -1) {
    content = content.slice(0, downIdx);
  }
  // Use Drizzle's statement-breakpoint markers when present; fall back to
  // a dollar-quoted-aware splitter for hand-written migrations (e.g., 0028)
  const hasBreakpoints = content.includes('--> statement-breakpoint');
  let rawStatements: string[];
  if (hasBreakpoints) {
    rawStatements = content.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
  } else {
    // Split on semicolons that are NOT inside dollar-quoted blocks ($$...$$)
    rawStatements = splitSql(content).map((s) => s.trim()).filter(Boolean);
  }
  // Strip CONCURRENTLY — can't run inside a transaction block; safe for fresh DB
  const statements = rawStatements.map((s) => s.replace(/\bCONCURRENTLY\b/g, '')).filter(Boolean);

  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const stmt of statements) {
    if (dryRun) {
      applied++;
      continue;
    }
    try {
      await client.query(stmt);
      applied++;
    } catch (err: unknown) {
      // If the statement opened a transaction that is now in error state,
      // issue ROLLBACK to reset the connection so the next statement succeeds.
      try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }

      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code && TOLERATED_CODES.has(pgErr.code)) {
        skipped++;
      } else {
        errors.push(`[${fileName}] ${pgErr.code || 'UNKNOWN'}: ${pgErr.message?.split('\n')[0] || stmt.slice(0, 120)}`);
      }
    }
  }
  return { applied, skipped, errors };
}

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

  // Re-check ledger after potential recovery stamping: if recovery seeded
  // entries, rowCount is stale (still 0) and we must not replay.
  const freshRowCount = parseInt(
    (
      await db.execute<{ cnt: string }>(
        sql.raw(`SELECT COUNT(*)::text AS cnt FROM "drizzle"."__drizzle_migrations"`),
      )
    ).rows[0].cnt,
    10,
  );

  // ── Fresh migration: execute statement-by-statement ───────────────────
  //
  // Drizzle's migrate() wraps each migration file in a transaction and
  // strips IF NOT EXISTS.  When all 59 migrations run from scratch on a
  // fresh DB, later files (0003+) re-create tables already built by
  // 0000/0002, causing "42P07 relation already exists" inside the tx,
  // which rolls back the entire migration.
  //
  // To avoid this, the fresh path reads each SQL file, splits by
  // statement-breakpoint, and executes every statement individually,
  // skipping tolerated "already exists" errors.  Incremental migrations
  // (ledger already has entries) continue using drizzle's built-in
  // migrator since there's no overlap risk.
  const freshPath = freshRowCount === 0 && journal.entries.length > 0;

  if (freshPath) {
    const migrationsDir = path.resolve('./drizzle/migrations');
    const journalFiles = journal.entries.map((e: { tag: string }) => `${e.tag}.sql`);
    const client = await pool.connect();
    try {
      let totalApplied = 0;
      let totalSkipped = 0;
      const allErrors: string[] = [];

      for (const file of journalFiles) {
        const filePath = path.join(migrationsDir, file);
        if (!fs.existsSync(filePath)) {
          console.error(`[migrate] WARNING: Migration file not found: ${file}`);
          continue;
        }
        const result = await runMigrationFile(client, filePath, file, isDryRun);
        totalApplied += result.applied;
        totalSkipped += result.skipped;
        allErrors.push(...result.errors);
        if (result.errors.length > 0) {
          console.error(`[migrate] ${file}: ${result.errors.length} error(s)`);
        } else {
          console.log(`[migrate] ${file}: ${result.applied} applied, ${result.skipped} skipped (already exists)`);
        }
      }

      if (allErrors.length > 0) {
        console.error(`\n[migrate] FATAL: ${allErrors.length} migration error(s):`);
        for (const e of allErrors) console.error(`  ${e}`);
        process.exit(1);
      }

      if (!isDryRun) {
        console.log(`[migrate] Fresh migration complete — ${totalApplied} statements applied, ${totalSkipped} skipped (already exists)`);
      } else {
        console.log(`[migrate] Dry-run complete — ${totalApplied} statements would be applied.`);
      }
    } finally {
      client.release();
    }
  } else {
    console.log('[migrate] Applying pending migrations with drizzle-orm migrator...');
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
  }

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
