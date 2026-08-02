#!/usr/bin/env node
/**
 * Verify DB objects match Drizzle schema & migration expectations.
 * Catches "stamped but never applied" drift (0032/0037 incidents):
 *  - missing tables vs pgTable() declarations
 *  - missing functions vs migration CREATE FUNCTION statements
 *  - tables with tenant_id but no RLS policy
 *
 * Usage: npm run db:drift-check
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { pgSslConfig } from '../lib/db/ssl-config';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl, ssl: pgSslConfig(), connectionTimeoutMillis: 10_000 });

  const errors: string[] = [];

  try {
    // 1. Tables expected from schema files
    const schemaDir = path.resolve(process.cwd(), 'drizzle/schema');
    const schemaFiles = fs.readdirSync(schemaDir).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));
    const expectedTables = new Set<string>();
    for (const f of schemaFiles) {
      const content = fs.readFileSync(path.join(schemaDir, f), 'utf8');
      const matches = content.matchAll(/pgTable\(\s*['"]([^'"]+)['"]/g);
      for (const m of matches) expectedTables.add(m[1]);
    }

    const actualTablesRes = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
    );
    const actualTables = new Set(actualTablesRes.rows.map(r => r.tablename));

    const missingTables = [...expectedTables].filter(t => !actualTables.has(t));
    const extraTables = [...actualTables].filter(t => !expectedTables.has(t));
    if (missingTables.length) errors.push(`MISSING TABLES: ${missingTables.join(', ')}`);
    if (extraTables.length) console.log(`[info] extra tables (not in schema): ${extraTables.join(', ')}`);

    // 2. Functions expected from migration files
    const migrationsDir = path.resolve(process.cwd(), 'drizzle/migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'));
    const expectedFunctions = new Set<string>();
    for (const f of migrationFiles) {
      const content = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const matches = content.matchAll(/CREATE (?:OR REPLACE )?FUNCTION\s+public\.(\w+)/g);
      for (const m of matches) expectedFunctions.add(m[1]);
    }

    const actualFunctionsRes = await pool.query(
      "SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace"
    );
    const actualFunctions = new Set(actualFunctionsRes.rows.map(r => r.proname));
    const missingFunctions = [...expectedFunctions].filter(f => !actualFunctions.has(f));
    if (missingFunctions.length) errors.push(`MISSING FUNCTIONS: ${missingFunctions.join(', ')}`);

    // 3. RLS: tables with a uuid tenant_id column but no policy.
    //    Mirrors 0037's rule: tables whose tenant_id is TEXT (e.g.
    //    super_admin_audit_logs) are intentionally exempt from tenant RLS.
    const rlsRes = await pool.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
        AND c.data_type = 'uuid'
        AND t.table_type = 'BASE TABLE'
        AND c.table_name NOT IN (
          SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public'
        )
      ORDER BY c.table_name
    `);
    const noRls = rlsRes.rows.map(r => r.table_name);
    if (noRls.length) errors.push(`TABLES WITH tenant_id BUT NO RLS: ${noRls.join(', ')}`);

    // 4. RLS enabled flag on tenant-scoped tables
    const rlsEnabledRes = await pool.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        AND c.relname IN (SELECT tablename FROM pg_policies WHERE schemaname = 'public')
    `);
    const rlsNotEnabled = rlsEnabledRes.rows.map(r => r.relname);
    if (rlsNotEnabled.length) errors.push(`TABLES WITH POLICIES BUT RLS DISABLED: ${rlsNotEnabled.join(', ')}`);

    console.log(`\n=== Drift Check ===`);
    console.log(`tables: ${actualTables.size}/${expectedTables.size} expected present`);
    console.log(`functions: ${actualFunctions.size}/${expectedFunctions.size} expected present`);
    console.log(`tenant-scoped tables without RLS policy: ${noRls.length}`);
    console.log(`policies: (from DB query above)`);

    if (errors.length) {
      console.log('\nDRIFT FOUND:\n');
      for (const e of errors) console.log(`  ✗ ${e}`);
      console.log('\nApply the missing DDL (re-run the idempotent migration or matching CREATE statements), then re-run this check.');
      process.exitCode = 1;
    } else {
      console.log('\nNo drift — schema matches migrations. ✓');
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
