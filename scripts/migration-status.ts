#!/usr/bin/env node
/**
 * Show migration status — what's applied vs pending.
 *
 * Usage: npm run db:status
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  try {
    // Get applied migrations
    let appliedMigrations: Array<{ name: string; applied_at: Date }> = [];
    try {
      const result = await db.execute(sql`
        SELECT name, applied_at
        FROM __drizzle_migrations
        ORDER BY applied_at ASC
      `);
      appliedMigrations = result.rows as Array<{ name: string; applied_at: Date }>;
    } catch {
      // Table doesn't exist yet — no migrations applied
      console.log('[status] Migration history table does not exist — no migrations applied yet');
    }

    const appliedNames = new Set(appliedMigrations.map(m => m.name));

    // Get migration files
    const migrationsDir = './drizzle/migrations';
    if (!fs.existsSync(migrationsDir)) {
      console.log('[status] No migrations directory found');
      process.exit(0);
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql'))
      .sort();

    console.log('\n=== Migration Status ===\n');

    if (migrationFiles.length === 0) {
      console.log('No migration files found');
      process.exit(0);
    }

    let appliedCount = 0;
    let pendingCount = 0;

    for (const file of migrationFiles) {
      const migrationName = file.replace('.sql', '');

      const isApplied = appliedMigrations.some(m => {
        return m.name.includes(migrationName) || migrationName.includes(m.name);
      });

      if (isApplied) {
        const applied = appliedMigrations.find(m => {
          return m.name.includes(migrationName) || migrationName.includes(m.name);
        });
        console.log(`  [✓] ${file} (applied: ${applied?.applied_at})`);
        appliedCount++;
      } else {
        console.log(`  [ ] ${file} (pending)`);
        pendingCount++;
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`  Applied: ${appliedCount}`);
    console.log(`  Pending: ${pendingCount}`);
    console.log(`  Total:   ${migrationFiles.length}`);

    if (pendingCount > 0) {
      console.log(`\n  Run 'npm run db:migrate' to apply pending migrations`);
    } else {
      console.log(`\n  Database is up to date`);
    }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[status] Failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
