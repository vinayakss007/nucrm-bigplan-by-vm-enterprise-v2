/**
 * Apply RLS migrations in CI (#2038).
 *
 * CI provisions the schema with `npm run db:sync` (drizzle-kit push),
 * which syncs only the TABLE structure. It does NOT run the hand-written
 * SQL migration files that create RLS objects. This script applies those
 * RLS up-migrations in journal order so integration tests can verify
 * row-level security.
 *
 * Files that cannot re-run on a pushed schema are reported as skipped,
 * not fatal. It then asserts RLS is ON for the core tenant-scoped
 * tables and exits non-zero if it is not.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'drizzle', 'migrations');

const RLS_MIGRATION_TAGS = [
  '0015_rls_policies',
  '0019_fix_rls_notifications',
  '0031_rls_remaining_tables',
  '0037_tenant_isolation_hardening',
  '0039_rls_fail_closed_policy',
  '0054_rls_phase0',
  '0060_add_tenantid_rls',
  '0068_force_rls_owner',
];

function readJournal() {
  const journalPath = join(migrationsDir, 'meta', '_journal.json');
  return JSON.parse(readFileSync(journalPath, 'utf8'));
}

function getAppliedTags() {
  const journal = readJournal();
  return new Set(journal.entries.map((e) => e.tag));
}

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const appliedTags = getAppliedTags();
  const results = [];

  for (const tag of RLS_MIGRATION_TAGS) {
    const upPath = join(migrationsDir, `${tag}.sql`);

    // Check if the up migration file exists
    try {
      readFileSync(upPath, 'utf8');
    } catch {
      results.push({ tag, status: 'missing', detail: 'SQL file not found' });
      continue;
    }

    if (appliedTags.has(tag)) {
      results.push({ tag, status: 'skipped', detail: 'already applied' });
      continue;
    }

    try {
      const sql = readFileSync(upPath, 'utf8');
      // Run the full SQL file as a single psql call
      execSync(
        `psql "${databaseUrl}" -v ON_ERROR_STOP=1 -f "${upPath}"`,
        { stdio: 'pipe', timeout: 30000 }
      );
      results.push({ tag, status: 'applied', detail: 'migration executed' });
    } catch (e) {
      // Some migrations reference tables/columns that don't exist after db:sync
      results.push({ tag, status: 'skipped', detail: e.message.slice(0, 80) });
    }
  }

  // Report results
  console.log('\nRLS migration results:');
  for (const r of results) {
    console.log(`  ${r.status.toUpperCase()}: ${r.tag} — ${r.detail}`);
  }

  // Assert RLS is ON for core tables
  const coreTables = ['contacts', 'companies', 'deals', 'tasks'];
  let allOk = true;
  console.log('\nRLS verification:');
  for (const table of coreTables) {
    try {
      const result = execSync(
        `psql "${databaseUrl}" -t -c "SELECT relrowsecurity FROM pg_class WHERE relname = '${table}'"`,
        { stdio: 'pipe', timeout: 10000 }
      ).toString().trim();
      if (result === 't') {
        console.log(`  OK: ${table} — RLS enabled`);
      } else {
        console.log(`  FAIL: ${table} — RLS disabled`);
        allOk = false;
      }
    } catch (e) {
      console.log(`  FAIL: ${table} — could not verify`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error('\nERROR: RLS not enabled on all core tables');
    process.exit(1);
  }

  console.log('\n✅ RLS migrations applied and verified');
}

main();
