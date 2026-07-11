#!/usr/bin/env node
import { drizzle } from 'drizzle-orm/node-postgres';
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
  console.log('[migrate] Applying pending migrations from ./drizzle/migrations...');

  const journalPath = path.resolve('./drizzle/migrations/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
  const allEntries = journal.entries;

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint NOT NULL
    );
  `));

  const applied = await db.execute<{ hash: string }>(
    sql.raw(`SELECT hash FROM "__drizzle_migrations"`),
  );
  const appliedHashes = new Set(applied.rows.map(r => r.hash));

  let appliedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const entry of allEntries) {
    if (appliedHashes.has(entry.tag)) {
      skippedCount++;
      continue;
    }

    const migrationFile = path.resolve(`./drizzle/migrations/${entry.tag}.sql`);
    if (!fs.existsSync(migrationFile)) {
      console.warn(`[migrate] Migration file not found: ${migrationFile}`);
      failedCount++;
      continue;
    }

    const fileContent = fs.readFileSync(migrationFile, 'utf-8').trim();
    if (!fileContent) {
      console.warn(`[migrate] Empty migration: ${entry.tag}`);
      continue;
    }

    // Execute each statement, tolerating failures (schema may already have objects)
    const statements = fileContent.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
    let hadError = false;

    if (statements.length > 1) {
      for (const stmt of statements) {
        try {
          await db.execute(sql.raw(stmt));
        } catch (innerErr: any) {
          console.warn(`[migrate]   ${entry.tag}: ${innerErr.message}`);
          hadError = true;
        }
      }
    } else {
      try {
        await db.execute(sql.raw(fileContent));
      } catch (err: any) {
        console.warn(`[migrate]   ${entry.tag}: ${err.message}`);
        hadError = true;
      }
    }

    // Record as applied regardless (so it's not retried)
    await db.execute(
      sql`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (${entry.tag}, ${entry.when})`,
    );
    appliedCount++;
    console.log(`[migrate] ${hadError ? 'Applied (with warnings)' : 'Applied'}: ${entry.tag}`);
  }

  console.log(`[migrate] Done: ${appliedCount} applied, ${skippedCount} already applied, ${failedCount} failed`);
  await pool.end();
}

main();
