#!/usr/bin/env node
import { execSync } from 'child_process';

console.log('[db-push] Syncing database schema...');
try {
  execSync('npx drizzle-kit push --config=./drizzle.config.ts', {
    stdio: 'inherit',
    env: { ...process.env },
  });
  console.log('[db-push] Schema sync complete');
} catch (error) {
  console.error('[db-push] Schema sync failed:', error);
  process.exit(1);
}
