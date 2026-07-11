#!/usr/bin/env node
/**
 * Bootstrap Drizzle migration tracking for an existing database.
 *
 * Problem: __drizzle_migrations table doesn't exist, so db:migrate
 * can't run. Running it would crash on 0000_init (tables exist, no
 * IF NOT EXISTS guards).
 *
 * Solution: Mark all existing migrations as already applied, so
 * future drizzle-kit generate + db:migrate only runs new ones.
 *
 * Usage: npx tsx scripts/bootstrap-migrations.ts
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, parse } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', 'drizzle', 'migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  // Read journal to get canonical migration list
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
  const journalEntries = journal.entries as Array<{ idx: number; tag: string; when: number }>;

  // Discover all SQL migration files sorted by name
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Match files to journal entries by tag
  const applied: Array<{ idx: number; tag: string; when: number }> = [];

  for (const file of files) {
    const tag = parse(file).name; // e.g. "0000_init"
    // Check if tag looks like a migration (starts with digit)
    if (!/^\d/.test(tag)) continue;

    const journalEntry = journalEntries.find(e => e.tag === tag);
    if (journalEntry) {
      applied.push(journalEntry);
    } else {
      // Not in journal — find its idx from a sibling or infer
      const idxMatch = tag.match(/^(\d+)/);
      const idx = idxMatch ? parseInt(idxMatch[1], 10) : applied.length;
      const when = Math.floor(Date.now() / 1000) * 1000 + idx;
      applied.push({ idx, tag, when });
      console.warn(`[warn] ${tag} not in journal — will mark as applied with inferred idx=${idx}`);
    }
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  // Create __drizzle_migrations table if not exists (Drizzle's format)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
    );
  `);

  // Check if already bootstrapped
  const countResult = await pool.query(`SELECT COUNT(*)::int as count FROM "__drizzle_migrations"`);
  const count = parseInt(countResult.rows[0]?.count ?? '0', 10);
  if (count > 0) {
    console.log(`[skip] __drizzle_migrations already has ${count} entries — bootstrap not needed`);
    await pool.end();
    return;
  }

  // Insert all migrations as applied with their hash (tag used as hash for simplicity)
  for (const entry of applied) {
    const hash = entry.tag; // Tag = hash for bootstrap
    await pool.query(
      `INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
      [hash, entry.when]
    );
    console.log(`  ✓ ${entry.tag} (idx=${entry.idx})`);
  }

  console.log(`\nDone! ${applied.length} migrations marked as applied.`);
  console.log(`Future 'npm run db:migrate' will only run new migrations.`);

  // Also fix the journal to include missing entries
  const existingTags = new Set(journalEntries.map(e => e.tag));
  const filesMissing: string[] = [];
  for (const file of files) {
    const tag = parse(file).name;
    if (!/^\d/.test(tag)) continue;
    if (!existingTags.has(tag)) {
      filesMissing.push(tag);
    }
  }
  if (filesMissing.length > 0) {
    console.log(`\n⚠️  ${filesMissing.length} migration files missing from _journal.json:`);
    for (const tag of filesMissing) {
      console.log(`     - ${tag}`);
    }
    console.log('   Add them to drizzle/migrations/meta/_journal.json to keep tracking consistent.');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
