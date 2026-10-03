#!/usr/bin/env node
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';
import { pgSslConfig } from '../lib/db/ssl-config';
import { runRecoveryStamp } from './migrate-recovery';
import {
  buildLedgerInsert,
  planMigrations,
  runFreshReplay,
  type FreshReplayStats,
  type LedgerRowLike,
  type PlannedFile,
} from './migrate-fresh';
import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';

/**
 * Fresh-replay branch (#2254 / #2235): statement splitting, the "already
 * exists" error allowlist, ledger stamping and CONCURRENTLY handling all
 * live in the pure, unit-tested helpers in `./migrate-fresh.ts`.
 *
 * History (kept for the next reader):
 *   - Drizzle's built-in migrator wraps each migration in ONE transaction and
 *     stops on the first error. On an empty ledger, later hand-written files
 *     (e.g. 0003) re-create objects built by 0000/0002, so the whole file
 *     rolled back — hence the separate replay branch.
 *   - The old replay tolerated 42703/42P01/42P11, stripped CONCURRENTLY, and
 *     never stamped `drizzle.__drizzle_migrations`. That produced false-green
 *     runs, lock storms, and a ledger that re-replayed ~2,919 statements
 *     (incl. DROP TABLE/DELETE/UPDATE) on every subsequent `db:migrate`.
 *     All three are fixed in migrate-fresh.ts; see its header comment.
 */

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

/** Read every row of the ledger drizzle's migrator consults. */
async function readLedgerRows(pool: Pool): Promise<LedgerRowLike[]> {
  const res = await pool.query<{ hash: string; created_at: string | null }>(
    `SELECT "hash", "created_at" FROM "drizzle"."__drizzle_migrations"`,
  );
  return res.rows.map((r) => ({ hash: r.hash, createdAt: r.created_at === null ? null : Number(r.created_at) }));
}

/** Print the --dry-run plan: per journal entry, already-stamped vs would-be
 *  replayed, with the hash/created_at the run would stamp. Read-only. */
function printDryRunPlan(plan: PlannedFile[], ledgerAvailable: boolean): void {
  const replay = plan.filter((p) => p.action === 'replay');
  const stamped = plan.filter((p) => p.action === 'skip-stamped');
  const missing = plan.filter((p) => p.action === 'missing-file');

  console.log(`[migrate] DRY RUN — plan for ${plan.length} journal entr(ies):`);
  for (const p of plan) {
    console.log(`  - ${p.tag.padEnd(40)} [${p.action}] created_at=${p.createdAt} hash=${(p.hash ?? '-').slice(0, 12)} (${p.reason})`);
  }
  console.log(`[migrate] Summary: ${stamped.length} already stamped, ${replay.length} to replay, ${missing.length} missing file(s).`);
  if (ledgerAvailable) {
    console.log('[migrate] Plan reflects the live drizzle.__drizzle_migrations ledger.');
  } else {
    console.log('[migrate] WARNING: ledger table is not readable yet — every entry is shown as pending;');
    console.log('[migrate] a real run creates the table and evaluates the empty-ledger recovery path first.');
  }
  if (missing.length > 0) {
    console.log('[migrate] WARNING: a real run FAILS on missing journal files (#2254 fail-loud).');
  }
  if (!ledgerAvailable || stamped.length === 0) {
    console.log('[migrate] NOTE: with an empty ledger the real run replays every file (fresh path) and');
    console.log('[migrate] stamps each one into drizzle.__drizzle_migrations after it applies (#2254).');
  }
  console.log('[migrate] Dry-run complete. No migrations applied.');
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
  const MIGRATIONS_DIR = path.resolve('./drizzle/migrations');
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

  const readFileOrNull = (tag: string): string | null => {
    const p = path.join(MIGRATIONS_DIR, `${tag}.sql`);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
  };
  const statMtimeOrNull = (tag: string): number | null => {
    const p = path.join(MIGRATIONS_DIR, `${tag}.sql`);
    return fs.existsSync(p) ? fs.statSync(p).mtimeMs : null;
  };

  // NOTE: --dry-run no longer exits here. It now connects (read-only), reads
  // the real ledger, and prints the full plan (which files are already
  // stamped vs would be replayed) before any write happens (#2254 AC).
  if (!isYes && !isDryRun) {
    // Non-interactive contexts (CI, deploy scripts, piped stdin) cannot answer
    // an interactive y/N prompt — the readline question would hang until the
    // job times out. Detect that and decide without blocking:
    //   - non-production targets (local/staging/unknown): auto-proceed. This is
    //     the CI/deploy happy path and keeps `npm run db:migrate` fail-proof
    //     for automation.
    //   - production: fail CLOSED. Refuse to apply unattended; require an
    //     explicit --yes so a prod migration is always a deliberate act.
    // Interactive TTYs keep the existing human confirmation prompt.
    const interactive = Boolean(process.stdin.isTTY) && process.env['CI'] !== 'true';

    if (!interactive) {
      if (env === 'production') {
        console.error(
          '[migrate] ERROR: Refusing to apply migrations to a "production" database ' +
          'in a non-interactive context without explicit confirmation.\n' +
          '[migrate] Re-run with --yes (e.g. `npm run db:migrate -- --yes`) to proceed.',
        );
        process.exit(1);
      }
      console.log(
        `[migrate] Non-interactive context detected — auto-applying ${pendingCount} ` +
        `migration(s) to the "${env}" database (use --dry-run to preview, or run in a ` +
        'TTY to be prompted).',
      );
    } else {
      const ok = await confirm(`Apply ${pendingCount} migration(s) to the "${env}" database? (y/N)`);
      if (!ok) {
        console.log('[migrate] Aborted by user.');
        process.exit(0);
      }
    }
  }

  const cleanUrl = databaseUrl.replace(/[?&]sslmode=[^&]+/, '');
  const pool = new Pool({
    connectionString: cleanUrl,
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

  // ── --dry-run: print the plan, change nothing (#2254 AC / #521 safety) ──
  // Read-only: consult the live ledger (if the table exists), classify every
  // journal entry as already-stamped / replay / missing-file, then exit 0.
  // Deliberately stops BEFORE the extension/ledger writes below.
  if (isDryRun) {
    let ledgerRows: LedgerRowLike[] = [];
    let ledgerAvailable = true;
    try {
      ledgerRows = await readLedgerRows(pool);
    } catch {
      ledgerAvailable = false; // fresh DB: "drizzle"."__drizzle_migrations" not created yet
    }
    printDryRunPlan(planMigrations(journal.entries, ledgerRows, readFileOrNull, statMtimeOrNull), ledgerAvailable);
    try {
      await lockClient.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
    } catch { /* auto-releases on disconnect */ }
    lockClient.release();
    await pool.end();
    process.exit(0);
  }

  // Required PostgreSQL extensions.
  //
  // Migrations rely on functions that live in extensions, not in core:
  //   - pgcrypto  -> gen_random_bytes() (0067_ticket_portal_token) and, on
  //                  PostgreSQL <= 12, gen_random_uuid() (258 column defaults).
  //   - uuid-ossp -> uuid_generate_v* (available if any migration uses it).
  //   - pg_trgm   -> trigram indexes/search.
  // These used to be created only in deploy/postgres/init.sql, which runs as
  // the Docker Postgres entrypoint hook and is NOT part of db:migrate. Any
  // managed/bare Postgres provisioned without that hook failed migration 0067
  // with "42883 function gen_random_bytes(integer) does not exist" — and worse,
  // 0067 partially applied (ADD COLUMN succeeded, backfill failed), leaving the
  // schema inconsistent. Creating them here makes db:migrate self-sufficient on
  // any target. IF NOT EXISTS keeps it a no-op when init.sql already ran.
  const REQUIRED_EXTENSIONS = ['pgcrypto', 'uuid-ossp', 'pg_trgm'];
  for (const ext of REQUIRED_EXTENSIONS) {
    try {
      await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS "${ext}"`));
    } catch (extErr) {
      const code = (extErr as { code?: string } | null)?.code;
      // 42501 insufficient_privilege: the migration role can't CREATE EXTENSION.
      // On many managed platforms extensions must be pre-installed by an admin
      // (or via a control-plane setting). Fail early with an actionable message
      // rather than deep inside migration 0067.
      console.error(`[migrate] ERROR: could not ensure extension "${ext}" exists${code ? ` (SQLSTATE ${code})` : ''}.`);
      console.error(`[migrate]   ${(extErr as Error).message}`);
      console.error('[migrate] The migration role needs privilege to CREATE EXTENSION, or an admin');
      console.error(`[migrate] must pre-create these extensions: ${REQUIRED_EXTENSIONS.join(', ')}.`);
      lockClient.release();
      await pool.end();
      process.exit(1);
    }
  }
  console.log(`[migrate] Ensured required extensions: ${REQUIRED_EXTENSIONS.join(', ')}`);

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
    await runRecoveryStamp({
      pool,
      journalEntries: journal.entries,
      readMigrationFile: (tag) => {
        const p = path.join(MIGRATIONS_DIR, `${tag}.sql`);
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
      },
    });
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

  // ── Fresh migration: replay files + STAMP the ledger (#2254) ───────────
  //
  // Drizzle's migrate() wraps each migration file in a transaction and stops
  // on the first error. On an empty ledger, later hand-written files (0003+)
  // re-create tables already built by 0000/0002, causing "42P07 relation
  // already exists" inside the tx, which rolls back the entire migration.
  //
  // The fresh path therefore replays each file itself — but under the OLD
  // behaviour it never wrote to drizzle.__drizzle_migrations, so every future
  // db:migrate replayed ~2,919 statements (incl. 3 DROP TABLE, ~8 DELETE,
  // ~40 UPDATE) over live data (#2254), tolerated destructive errors
  // (42703/42P01/42P11) as "skipped" (#2235), and stripped CONCURRENTLY.
  //
  // New behaviour (all logic in ./migrate-fresh.ts, unit-tested):
  //   - planMigrations(): skip files whose hash OR created_at is already in
  //     the ledger (idempotent, resumable);
  //   - applyMigrationFile(): per-chunk transactions with per-statement
  //     savepoints; only "already exists" (42P07/42710) is tolerated — any
  //     other error ROLLS BACK the file and ABORTS the run non-zero;
  //   - CREATE INDEX CONCURRENTLY is preserved and executed OUTSIDE the
  //     transaction;
  //   - each successfully applied file is stamped immediately with
  //     (hash = sha256 of the file bytes — same as drizzle-kit computes,
  //      created_at = journal entry.when ms, fallback file mtime);
  //   - post-run verification re-derives the plan: every journal entry must
  //     now read as skip-stamped, otherwise the next run would replay and we
  //     exit 1.
  // Incremental migrations (ledger non-empty) keep using drizzle's built-in
  // migrator unchanged.
  const freshPath = freshRowCount === 0 && journal.entries.length > 0;

  if (freshPath) {
    const freshPlan = planMigrations(journal.entries, await readLedgerRows(pool), readFileOrNull, statMtimeOrNull);
    const toReplay = freshPlan.filter((p) => p.action === 'replay').length;
    const alreadyStamped = freshPlan.filter((p) => p.action === 'skip-stamped').length;
    console.log(`[migrate] Fresh path: ${toReplay} file(s) to replay, ${alreadyStamped} already stamped, ${freshPlan.length} journal entr(ies) total.`);

    // Newer drizzle-kit versions add an "fk_updates" column to the ledger;
    // include it (=0/false) only when it exists on this DB.
    const fkRes = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations' AND column_name = 'fk_updates'`,
    );
    const fkColumn = fkRes.rows[0]?.data_type ?? null;

    // #2235: the "does not exist" file-order quirks (0002/0004 → repaired by
    // 0046) may ONLY be tolerated when the public schema is verifiably empty
    // before the first statement — with zero tables there is no data to
    // clobber. On any other DB these errors abort the run.
    const tablesRes = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const publicTableCount = parseInt(tablesRes.rows[0].cnt, 10);
    const zeroTableFreshBuild = publicTableCount === 0;
    console.log(`[migrate] Public schema has ${publicTableCount} table(s) before replay — ` +
      (zeroTableFreshBuild
        ? 'true zero-table build ("does not exist" file-order quirks tolerated, e.g. 0004 → repaired by 0046).'
        : 'partial/legacy state: every non-"already exists" statement error ABORTS the run (#2235).'));

    const client = await pool.connect();
    let stats: FreshReplayStats;
    try {
      stats = await runFreshReplay({
        client,
        plan: freshPlan,
        readFile: readFileOrNull,
        zeroTableFreshBuild,
        stamp: async (row) => {
          const { text, params } = buildLedgerInsert(row, fkColumn);
          await pool.query(text, params);
        },
      });
    } finally {
      client.release();
    }

    if (stats.fatal.length > 0) {
      console.error(`\n[migrate] FATAL: fresh replay aborted with ${stats.fatal.length} error(s):`);
      for (const e of stats.fatal) console.error(`  ${e}`);
      console.error('[migrate] The failing file was NOT stamped; files stamped so far are recorded.');
      console.error('[migrate] Fix the underlying SQL (this run no longer swallows real errors — #2235),');
      console.error('[migrate] then re-run db:migrate to resume.');
      try {
        await lockClient.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
      } catch { /* auto-releases on disconnect */ }
      lockClient.release();
      await pool.end();
      process.exit(1);
    }

    // Backfill pass: entries the plan skipped by HASH-match (the journal has
    // identical-content no-op files that share a sha256 but have distinct
    // `when`s) still need their own created_at row — drizzle's no-op decision
    // reads max(created_at), so a missing created_at would replay from there.
    const ledgerRowsNow = await readLedgerRows(pool);
    const stampedCreatedAts = new Set(ledgerRowsNow.map((r) => Number(r.createdAt)));
    let backfilled = 0;
    for (const p of freshPlan) {
      if (p.action === 'missing-file' || p.hash === null || stampedCreatedAts.has(p.createdAt)) continue;
      const { text, params } = buildLedgerInsert({ hash: p.hash, createdAt: p.createdAt }, fkColumn);
      await pool.query(text, params);
      stampedCreatedAts.add(p.createdAt);
      backfilled++;
    }
    if (backfilled > 0) {
      console.log(`[migrate] Backfilled ${backfilled} ledger row(s) for entries whose file content duplicates an earlier stamped file`);
    }

    console.log(`[migrate] Fresh migration complete — ${stats.applied} statements applied (${stats.concurrent} CONCURRENTLY outside transactions), ${stats.skipped} skipped (already exists)`
      + (stats.skippedZeroTableQuirk > 0 ? `, ${stats.skippedZeroTableQuirk} skipped (file-order quirk, zero-table build)` : '')
      + `, ${stats.stampedTags.length} ledger row(s) stamped this run.`);

    // Post-run verification: the ledger must now cover EVERY journal entry,
    // otherwise the next db:migrate would replay again — the exact #2254 bug.
    const verifyPlan = planMigrations(journal.entries, await readLedgerRows(pool), readFileOrNull, statMtimeOrNull);
    const unstamped = verifyPlan.filter((p) => p.action !== 'skip-stamped');
    if (unstamped.length > 0) {
      console.error(`[migrate] FATAL: ledger still missing ${unstamped.length} entr(s): ${unstamped.map((p) => p.tag).join(', ')}`);
      console.error('[migrate] Refusing to report success: the next db:migrate would replay these files.');
      try {
        await lockClient.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]);
      } catch { /* auto-releases on disconnect */ }
      lockClient.release();
      await pool.end();
      process.exit(1);
    }
    console.log(`[migrate] Ledger verified: all ${journal.entries.length} journal entries stamped — subsequent db:migrate runs are no-ops.`);
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
