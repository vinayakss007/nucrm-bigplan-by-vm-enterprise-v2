/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 *
 * Bootstraps the `nucrm_test` database for integration tests.
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nucrm_test" \
 *   DATABASE_SSL="false" \
 *   npx tsx scripts/bootstrap-test-db.ts
 *
 * Creates the database if missing, then applies all migrations.
 * Safe to re-run (idempotent).
 */

import { Pool } from 'pg';
import { execSync } from 'child_process';

const TEST_DB = 'nucrm_test';

async function main() {
  const adminUrl = process.env.DATABASE_URL?.replace(/\/[^\/]+$/, '/postgres') ||
    'postgresql://postgres:postgres@localhost:5432/postgres';
  const ssl = process.env.DATABASE_SSL === 'true';

  const adminPool = new Pool({ connectionString: adminUrl, ssl });

  // Check if the test database exists.
  const { rows } = await adminPool.query(
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [TEST_DB]
  );

  if (rows.length === 0) {
    console.log(`[bootstrap-test-db] Creating database '${TEST_DB}'...`);
    await adminPool.query(`CREATE DATABASE "${TEST_DB}"`);
    console.log(`[bootstrap-test-db] Database '${TEST_DB}' created.`);
  } else {
    console.log(`[bootstrap-test-db] Database '${TEST_DB}' already exists.`);
  }

  await adminPool.end();

  // Apply migrations to the test database.
  console.log('[bootstrap-test-db] Applying migrations...');
  execSync('npx tsx scripts/migrate.ts', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ||
        `postgresql://postgres:postgres@localhost:5432/${TEST_DB}`,
      DATABASE_SSL: ssl ? 'true' : 'false',
    },
  });
  console.log('[bootstrap-test-db] Migrations applied successfully.');
}

main().catch((err) => {
  console.error('[bootstrap-test-db] Failed:', err);
  process.exit(1);
});
