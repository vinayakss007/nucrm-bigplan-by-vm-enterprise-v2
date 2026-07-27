#!/usr/bin/env npx tsx
/**
 * Migration rollback CLI (issue #640)
 *
 * All the real work lives in `lib/db/rollback.ts` so it is type-checked and
 * unit-tested (scripts/** is excluded from tsconfig). This file is just the CLI.
 *
 * Usage:
 *   npm run db:rollback -- --list
 *   npm run db:rollback:coverage
 *   npm run db:rollback -- --dry-run
 *   npm run db:rollback -- 0045_rls_fail_closed_policy --yes
 *   npm run db:rollback -- 0043_tenant_isolation_hardening --force --yes
 */
import { createInterface } from 'readline';
import {
  listAppliedMigrations,
  parseRollbackSql,
  rollbackMigration,
  verifyRollbackCoverage,
} from '../lib/db/rollback';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isYes = args.includes('--yes') || args.includes('-y');
const isList = args.includes('--list');
const isCoverage = args.includes('--coverage');
const isForce = args.includes('--force');
const positional = args.filter((a) => !a.startsWith('-'));
const requestedTag = positional[0];

function detectEnv(url: string): string {
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';
  if (url.includes('staging') || url.includes('dev.')) return 'staging';
  if (url.includes('prod') || url.includes('production')) return 'production';
  return 'unknown';
}

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(prompt: string): Promise<boolean> {
  const answer = (await ask(prompt)).toLowerCase();
  return answer === 'y' || answer === 'yes';
}

function printCoverage(): void {
  const coverage = verifyRollbackCoverage();
  console.log('[rollback] Rollback coverage report');
  console.log(
    `[rollback] ${coverage.covered}/${coverage.total} migrations have rollback SQL (${coverage.coveragePercent}%)`,
  );
  for (const entry of coverage.entries) {
    const mark = entry.hasRollback ? 'OK  ' : 'MISS';
    const source = entry.source ? ` (${entry.source})` : '';
    console.log(`  ${mark} ${String(entry.idx).padStart(3, ' ')} ${entry.tag}${source}`);
  }
  if (coverage.missing > 0) {
    console.log(`[rollback] ${coverage.missing} migration(s) cannot be rolled back automatically.`);
  }
}

async function main() {
  // --coverage is filesystem-only: no database needed.
  if (isCoverage) {
    printCoverage();
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const env = detectEnv(databaseUrl);
  console.log(`[rollback] Target database environment: ${env}`);

  const applied = await listAppliedMigrations();

  if (isList) {
    if (applied.length === 0) {
      console.log('[rollback] No applied migrations recorded.');
      return;
    }
    console.log('[rollback] Applied migrations (newest first):');
    for (const m of applied) {
      const when = m.appliedAt ? m.appliedAt.toISOString() : 'unknown';
      const rollback = m.hasRollback ? 'rollback available' : 'NO ROLLBACK';
      console.log(`  ${String(m.idx).padStart(3, ' ')} ${m.tag}  applied=${when}  ${rollback}`);
    }
    return;
  }

  if (applied.length === 0) {
    console.log('[rollback] No migrations to rollback');
    return;
  }

  const tag = requestedTag ?? applied[0]!.tag;
  console.log(`[rollback] Target migration: ${tag}`);

  const sql = await parseRollbackSql(tag);
  if (!sql) {
    console.error(`[rollback] No rollback SQL found for "${tag}".`);
    console.error(`[rollback] Create "${tag}.down.sql", or add a "-- DOWN" / "-- END DOWN" section`);
    console.error('[rollback] to the migration file, or roll back manually.');
    process.exit(1);
  }

  console.log('[rollback] Rollback SQL preview:');
  console.log(sql.slice(0, 500));
  if (sql.length > 500) {
    console.log(`... (${sql.length - 500} more characters)`);
  }
  console.log('[rollback] WARNING: This will reverse the migration and may cause DATA LOSS.');

  if (!isDryRun) {
    if (env === 'production' && !isYes) {
      console.error('[rollback] ERROR: Running rollback on production without --yes flag is forbidden.');
      console.error('[rollback] Pass --yes to confirm you understand the risks.');
      process.exit(1);
    }

    if (!isYes) {
      const ok = await confirm(`Rollback "${tag}" on the "${env}" database? (y/N)`);
      if (!ok) {
        console.log('[rollback] Aborted by user.');
        return;
      }
    }
  }

  const result = await rollbackMigration(tag, { dryRun: isDryRun, force: isForce });

  if (result.dryRun) {
    console.log('[rollback] Dry-run complete: transaction rolled back, nothing was changed.');
    return;
  }

  console.log(`[rollback] Rollback completed successfully (source: ${result.source})`);
  console.log('[rollback] Migration record removed from history — it can be re-applied.');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[rollback] Rollback failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
