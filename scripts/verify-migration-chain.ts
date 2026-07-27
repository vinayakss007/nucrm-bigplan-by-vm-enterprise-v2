#!/usr/bin/env npx tsx
/**
 * Prove that the migration chain can build the schema from an empty database.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * CI provisions its database with `npm run db:sync` (drizzle-kit push), straight
 * from the schema files. The migrations are therefore never executed by anything,
 * and 3000+ passing tests say nothing about whether they work. Disaster recovery
 * depends on them working.
 *
 * Run against a THROWAWAY database:
 *   DATABASE_URL=postgres://.../scratch npm run db:verify-chain
 *
 * It applies every journalled migration in journal order and stops at the first
 * failure, printing the offending statement. Exits non-zero on any problem, so it
 * can gate a release once the chain is repaired.
 *
 * KNOWN TO FAIL TODAY. See docs/migration-chain-state.md — 0000_init and
 * 0037_flat_sir_ram are two overlapping lineages of the same schema and cannot
 * both be applied. This script exists to keep that measurable rather than
 * invisible.
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'drizzle', 'migrations');

interface JournalEntry {
  idx: number;
  tag: string;
}

function loadJournal(): JournalEntry[] {
  const p = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(p, 'utf8')) as { entries: JournalEntry[] };
  return journal.entries;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required (point it at a scratch database)');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    // Refuse to run against a database that already has content: this applies
    // 0000_init, which is not safe against a populated schema.
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const existingTables = parseInt(rows[0]?.count ?? '0', 10);
    if (existingTables > 0 && !process.argv.includes('--force')) {
      console.error(
        `ERROR: target database already has ${existingTables} table(s).\n` +
          'This must run against an EMPTY scratch database. Pass --force to override.'
      );
      process.exit(1);
    }

    const entries = loadJournal();
    console.log(`\nApplying ${entries.length} migrations in journal order\n`);

    let applied = 0;

    for (const entry of entries) {
      const file = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
      const label = entry.tag.padEnd(45);

      if (!existsSync(file)) {
        console.error(`${String(entry.idx).padStart(3)} ${label} MISSING FILE`);
        console.error('\nA journal entry has no corresponding .sql file.');
        process.exitCode = 1;
        return;
      }

      // `--> statement-breakpoint` is drizzle's own separator, not SQL.
      const sql = readFileSync(file, 'utf8').replaceAll('--> statement-breakpoint', '');

      const client = await pool.connect();
      try {
        await client.query(sql);
        applied++;
        console.log(`${String(entry.idx).padStart(3)} ${label} ok`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`${String(entry.idx).padStart(3)} ${label} FAILED`);
        console.error(`      ${message}`);
        console.error(
          `\nStopped at ${entry.idx} (${entry.tag}). ` +
            `${entries.length - entry.idx - 1} migration(s) never ran.`
        );
        console.error(
          '\nA fresh database cannot be built from these migrations, which means\n' +
            'there is no tested path from empty to the current schema.'
        );
        process.exitCode = 1;
        return;
      } finally {
        client.release();
      }
    }

    // Sanity check: a chain that "succeeds" but produces almost nothing is still
    // broken.
    const after = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const tableCount = parseInt(after.rows[0]?.count ?? '0', 10);

    console.log(`\nApplied ${applied}/${entries.length} migrations`);
    console.log(`Tables created: ${tableCount}`);

    if (tableCount < 200) {
      console.error(
        `\nFAIL: only ${tableCount} tables exist; the schema defines 220. ` +
          'The chain completed but did not build the full schema.'
      );
      process.exitCode = 1;
      return;
    }

    console.log('\nPASS — the schema can be built from an empty database\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('verify-migration-chain failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
