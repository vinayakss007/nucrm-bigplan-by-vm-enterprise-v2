#!/usr/bin/env node
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';
import * as fs from 'fs';
import * as path from 'path';

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

  const useSsl = process.env.DATABASE_SSL === 'true';

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  console.log('[migrate] Connecting to database...');

  // Recovery: if __drizzle_migrations is empty/missing but schema tables already
  // exist, the tracking table was lost (e.g. DB restore). Pre-populate it so
  // that migrate() does not try to re-apply all migrations on existing objects.
  const journalPath = path.resolve('./drizzle/migrations/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint NOT NULL
    );
  `));

  const count = await db.execute<{ cnt: string }>(
    sql.raw(`SELECT COUNT(*)::text AS cnt FROM "__drizzle_migrations"`),
  );
  const rowCount = parseInt(count.rows[0].cnt, 10);

  if (rowCount === 0 && journal.entries.length > 0) {
    // Check whether this is a recovery scenario (schema exists) or a fresh DB
    const schemaExists = await db.execute<{ exists: boolean }>(
      sql.raw(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'api_key_usage')`),
    );

    if (schemaExists.rows[0].exists) {
      console.log(`[migrate] Recovery: schema exists but tracking table is empty.`);
      console.log(`[migrate] Seeding __drizzle_migrations with ${journal.entries.length} entries...`);
      for (const entry of journal.entries) {
        await db.execute(
          sql`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (${entry.tag}, ${entry.when})`,
        );
      }
      console.log('[migrate] Recovery complete.');
    } else {
      console.log('[migrate] Fresh database detected. Running all migrations...');
    }
  }

  console.log('[migrate] Applying pending migrations with drizzle-orm migrator...');
  await migrate(db, { migrationsFolder: './drizzle/migrations' });

  console.log('[migrate] Done.');
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] Fatal:', err);
  process.exit(1);
});
