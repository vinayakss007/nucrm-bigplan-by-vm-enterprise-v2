/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Apply the RLS migrations in CI — the half of the schema `db:sync` cannot create.
 *
 * The integration job provisions its database with `npm run db:sync`
 * (drizzle-kit push), which only creates the Drizzle schema. Row-Level Security
 * is enabled by HAND-WRITTEN SQL migrations (ENABLE ROW LEVEL SECURITY +
 * CREATE POLICY — 0015_rls_policies.sql, 0031_..., 0037_..., 0054_...), so RLS
 * is OFF in CI by construction and tests/integration/tenant-isolation.test.ts
 * fails with `RLS should be enabled on "contacts": expected false to be true`.
 *
 * This closes that gap without switching CI to the full migration chain (the
 * journal drift tracked in #682 makes that unsafe today):
 *
 *   1. Reads drizzle/migrations/meta/_journal.json and takes every UP migration
 *      whose filename mentions RLS, in journal order.
 *   2. Applies each file as-is. Files that also alter column definitions (e.g.
 *      0060_add_tenantid_rls adds tenant_id columns that push already created)
 *      cannot re-run on a pushed schema; those are reported as skipped instead
 *      of failing the build.
 *   3. Asserts RLS is actually ON for the core tenant tables — the invariant CI
 *      depends on — and exits non-zero when it is not.
 *
 * Safe for the suite: CI connects as the throwaway database superuser, and
 * PostgreSQL exempts superusers from RLS, so this changes what the assertions
 * read in pg_class without changing any test query result.
 *
 * Usage: DATABASE_URL=postgresql://... node scripts/apply-rls-ci.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'drizzle',
  'migrations'
);
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

/** Tables the integration suite asserts RLS on (tenant-isolation.test.ts). */
const CORE_TABLES = ['contacts', 'companies', 'deals', 'tasks'];

/**
 * Migrations that enable/harden RLS, applied in journal order.
 *
 * Mixed migrations that create tables AND enable RLS on them (0038, 0041,
 * 0059) are deliberately excluded: `db:sync` already created those tables, so
 * re-running the CREATE TABLE half would fail. Their tables are therefore not
 * RLS-enabled in CI, which is why CORE_TABLES is asserted below rather than a
 * table count.
 */
const RLS_MIGRATION_TAGS = [
  '0015_rls_policies',
  '0019_fix_rls_notifications',
  '0031_rls_remaining_tables',
  '0037_tenant_isolation_hardening',
  '0039_rls_fail_closed_policy',
  '0054_rls_phase0',
  '0060_add_tenantid_rls',
  '0068_force_rls_owner',
];

/** The RLS up-migrations that exist on disk, in journal order. */
function rlsMigrations() {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8'));
  return journal.entries
    .map((entry) => ({ idx: entry.idx, file: `${entry.tag}.sql` }))
    .filter(
      ({ file }) => RLS_MIGRATION_TAGS.includes(file.replace(/\.sql$/, '')) && existsSync(join(MIGRATIONS_DIR, file))
    )
    .sort((a, b) => a.idx - b.idx);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set — refusing to run.');
    process.exit(1);
  }

  const migrations = rlsMigrations();
  console.log(`Applying ${migrations.length} RLS migration(s) ...`);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  let applied = 0;
  let skipped = 0;
  try {
    for (const { idx, file } of migrations) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query(sql);
        applied += 1;
        console.log(`  ✓ ${String(idx).padStart(3)} ${file}`);
      } catch (err) {
        skipped += 1;
        const reason = String(err instanceof Error ? err.message : err).split('\n')[0];
        console.warn(`  ⚠ skipped ${file}: ${reason}`);
      }
    }

    const { rows } = await client.query(
      `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [CORE_TABLES]
    );

    const enabled = new Map(rows.map((row) => [row.table_name, row.rls_enabled === true]));
    const missing = CORE_TABLES.filter((table) => enabled.get(table) !== true);

    console.log(`RLS migrations applied: ${applied}; skipped: ${skipped}`);
    if (missing.length > 0) {
      console.error(`FAIL: RLS is not enabled on: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`OK: RLS enabled on ${CORE_TABLES.join(', ')}`);
  } finally {
    await client.end();
  }
}

await main();
