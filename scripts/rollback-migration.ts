#!/usr/bin/env node
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../drizzle/schema';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isYes = args.includes('--yes') || args.includes('-y');

function detectEnv(url: string): string {
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';
  if (url.includes('staging') || url.includes('dev.')) return 'staging';
  if (url.includes('prod') || url.includes('production')) return 'production';
  return 'unknown';
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const env = detectEnv(databaseUrl);
  console.log(`[rollback] Target database environment: ${env}`);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  console.log('[rollback] Checking migration history...');

  try {
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

    const migrationsDir = './drizzle/migrations';
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

    const targetFile = files.find(f => f.includes(migration.name.slice(0, 20)));

    if (!targetFile) {
      console.error('[rollback] Could not find migration SQL file to rollback');
      console.error('[rollback] Manual rollback may be required');
      process.exit(1);
    }

    console.log(`[rollback] Found migration file: ${targetFile}`);

    const downFile = targetFile.replace('.sql', '.down.sql');
    const downPath = path.join(migrationsDir, downFile);

    if (!fs.existsSync(downPath)) {
      console.error('[rollback] No down migration file found');
      console.error('[rollback] Create a .down.sql file with reversal statements, or rollback manually');
      process.exit(1);
    }

    const downSql = fs.readFileSync(downPath, 'utf-8');
    const preview = downSql.slice(0, 200);
    console.log('[rollback] Rollback SQL preview:');
    console.log(preview);
    if (downSql.length > 200) {
      console.log(`... (${downSql.length - 200} more characters)`);
    }
    console.log('[rollback] WARNING: This will reverse the migration and may cause DATA LOSS.');

    if (isDryRun) {
      console.log('[rollback] Dry-run complete. No rollback executed.');
      process.exit(0);
    }

    if (!isYes) {
      if (env === 'production') {
        console.log('[rollback] PRODUCTION ENVIRONMENT: type the migration name to confirm:');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const typed = await new Promise<string>((resolve) => {
          rl.question('> ', (answer) => { rl.close(); resolve(answer.trim()); });
        });
        if (typed !== migration.name) {
          console.log('[rollback] Migration name does not match. Aborted.');
          process.exit(0);
        }
      } else {
        const ok = await confirm(`Rollback "${migration.name}" on the "${env}" database? (y/N)`);
        if (!ok) {
          console.log('[rollback] Aborted by user.');
          process.exit(0);
        }
      }
    } else if (env === 'production' && !isYes) {
      console.error('[rollback] ERROR: Running rollback on production without --yes flag is forbidden.');
      console.error('[rollback] Pass --yes to confirm you understand the risks.');
      process.exit(1);
    }

    console.log(`[rollback] Executing rollback from ${downFile}...`);
    await db.execute(sql.raw(downSql));
    console.log('[rollback] Rollback completed successfully');

    await db.execute(sql`
      DELETE FROM __drizzle_migrations WHERE id = ${migration.id}
    `);
    console.log('[rollback] Migration record removed from history');

  } catch (error: any) {
    console.error('[rollback] Rollback failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
