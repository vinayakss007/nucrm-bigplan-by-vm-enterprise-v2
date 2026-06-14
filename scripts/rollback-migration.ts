#!/usr/bin/env node
/**
 * Rollback the last applied migration.
 *
 * WARNING: Rollbacks can cause data loss. Always backup before rolling back.
 * This script reads the migration history and reverses the last migration.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

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

  console.log('[rollback] Checking migration history...');

  try {
    // Get the last applied migration
    const result = await db.execute(sql`
      SELECT id, name, applied_at
      FROM __drizzle_migrations
      ORDER BY applied_at DESC
      LIMIT 1
    `);

    const rows = result.rows as Array<{ id: string; name: string; applied_at: Date }>;

    if (rows.length === 0) {
      console.log('[rollback] No migrations to rollback');
      process.exit(0);
    }

    const migration = rows[0];
    if (!migration) {
      console.log('[rollback] No migrations to rollback');
      process.exit(0);
    }
    console.log(`[rollback] Last migration: ${migration.name} (applied at ${migration.applied_at})`);

    // Find the corresponding SQL file
    const migrationsDir = './drizzle/migrations';
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

    // Look for the migration file that matches the name
    const targetFile = files.find(f => f.includes(migration.name.slice(0, 20)));

    if (!targetFile) {
      console.error('[rollback] Could not find migration SQL file to rollback');
      console.error('[rollback] Manual rollback may be required');
      process.exit(1);
    }

    console.log(`[rollback] Found migration file: ${targetFile}`);
    console.log('[rollback] WARNING: This will execute the DOWN statements if available');
    console.log('[rollback] For safety, review the migration file manually before proceeding');

    // Check if there's a corresponding down file
    const downFile = targetFile.replace('.sql', '.down.sql');
    const downPath = path.join(migrationsDir, downFile);

    if (fs.existsSync(downPath)) {
      const downSql = fs.readFileSync(downPath, 'utf-8');
      console.log(`[rollback] Executing rollback from ${downFile}...`);

      await db.execute(sql.raw(downSql));
      console.log('[rollback] Rollback completed successfully');
    } else {
      console.error('[rollback] No down migration file found');
      console.error('[rollback] Create a .down.sql file with reversal statements, or rollback manually');
      process.exit(1);
    }

    // Remove the migration record
    await db.execute(sql`
      DELETE FROM __drizzle_migrations WHERE id = ${migration.id}
    `);
    console.log('[rollback] Migration record removed from history');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[rollback] Rollback failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
