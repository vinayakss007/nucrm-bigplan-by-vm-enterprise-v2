#!/usr/bin/env node
/**
 * Generate a new Drizzle migration by comparing current schema to database state.
 *
 * Usage:
 *   npm run db:generate -- "add user avatar column"
 *   npm run db:generate -- "create notification preferences table"
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

function main() {
  const description = process.argv.slice(2).join(' ') || 'auto-generated';

  // Sanitize description for filename
  const safeName = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

  if (!safeName) {
    console.error('ERROR: Please provide a migration description');
    console.error('Usage: npm run db:generate -- "description of changes"');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Check drizzle config exists
  if (!existsSync('./drizzle.config.ts')) {
    console.error('ERROR: drizzle.config.ts not found in project root');
    process.exit(1);
  }

  console.log(`[generate] Creating migration: ${description}`);

  try {
    // Use drizzle-kit to generate the migration
    execSync(
      `npx drizzle-kit generate --name="${safeName}" --config=./drizzle.config.ts`,
      { stdio: 'inherit' }
    );

    console.log(`[generate] Migration generated successfully`);
    console.log(`[generate] Review the files in ./drizzle/migrations/ before deploying`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('[generate] Migration generation failed:', error.message);
    process.exit(1);
  }
}

main();
