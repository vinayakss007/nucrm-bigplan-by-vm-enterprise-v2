#!/usr/bin/env node
import { Pool } from 'pg';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('[drop-all] Dropping all schemas (public + drizzle)...');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO public');
    console.log('[drop-all] All tables dropped successfully');
  } catch (error) {
    console.error('[drop-all] Failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
