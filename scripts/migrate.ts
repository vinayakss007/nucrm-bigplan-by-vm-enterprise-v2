#!/usr/bin/env node
/**
 * Production-safe migration runner
 *
 * Applies pending Drizzle migrations in order.
 * Safe for zero-downtime deploys — only runs new migrations.
 * Never drops tables or columns (that requires separate down scripts).
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Reject production-like URLs with dev credentials
  if (databaseUrl.includes('dev-jwt-secret') || databaseUrl.includes('change-in-production')) {
    console.error('ERROR: Weak/dev credentials detected. Set strong secrets before migrating.');
    process.exit(1);
  }

  const useSsl = process.env.DATABASE_SSL === 'true';

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  console.log('[migrate] Connecting to database...');
  console.log('[migrate] Applying pending migrations from ./drizzle/migrations...');

  try {
    await migrate(db, {
      migrationsFolder: './drizzle/migrations',
      migrationsTable: '__drizzle_migrations',
    });

    console.log('[migrate] All migrations applied successfully');
  } catch (error: any) {
    console.error('[migrate] Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
