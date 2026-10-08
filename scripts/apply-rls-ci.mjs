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
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildShapeSweepSql,
  parseShapeSweep,
  evaluateShapeSweep,
} from './rls-policy-shape.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'drizzle', 'migrations');

// #2232: discover RLS/security-policy migrations instead of a hand-maintained
// whitelist — the old list stopped at 0068, so 0088-0096 (NULL-tenant leak
// closure, member-read, superadmin bypass) were never applied in CI and any
// regression of an 0088-class bug passed green. Match is deliberately wide:
// files that cannot re-run on a pushed schema are reported skipped, not fatal,
// so over-inclusion costs noise while under-inclusion costs safety.
const RLS_TAG_RE = /rls|isolation|polic|bypass|member_read|tenant_reference|force_/i;

function discoverRlsTags() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .filter((tag) => RLS_TAG_RE.test(tag))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

const RLS_MIGRATION_TAGS = discoverRlsTags();
if (RLS_MIGRATION_TAGS.length === 0) {
  console.error('[apply-rls-ci] RLS discovery matched zero migrations — pattern or migrations dir broken');
  process.exit(1);
}

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

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

    // NOTE: do NOT skip tags listed in meta/_journal.json — the journal
    // describes migrations that exist in the repo, not migrations already
    // applied to this database. CI provisions a fresh DB via `db:sync`
    // (drizzle-kit push), which creates no migration history, so every RLS
    // file must be attempted. Files that cannot re-run on a pushed schema
    // fail below and are reported as skipped instead of fatal.

    try {
      // Run the full SQL file as a single psql call
      execSync(
        `psql "${databaseUrl}" -v ON_ERROR_STOP=1 -f "${upPath}"`,
        { stdio: 'pipe', timeout: 30000 }
      );
      results.push({ tag, status: 'applied', detail: 'migration executed' });
    } catch (_e) {
      // Some migrations reference tables/columns that don't exist after db:sync
      results.push({ tag, status: "skipped", detail: _e.message.slice(0, 80) });
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
    } catch (_e) {
      console.log(`  FAIL: ${table} — could not verify`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error('\nERROR: RLS not enabled on all core tables');
    process.exit(1);
  }

  // #2438 — assert that no tenant table is left with the error-raising
  // `tenant_isolation` policy.
  //
  // `current_setting('app.current_tenant')` with ONE argument aborts the whole
  // statement when no tenant GUC exists, instead of denying the row. `0037`
  // still emits exactly that pair (`0037:239`, `0037:247-249`) for every table
  // whose `tenant_id` is NOT NULL, and `0039` — the migration written to end it —
  // only rewrites tables that *already* have a `tenant_isolation` policy when its
  // loop runs (`0039:46-53` `CONTINUE`) and swallows each per-table failure into a
  // `RAISE WARNING` (`0039:79-81`). A tenant table hardened after that loop, or
  // skipped by it, therefore keeps the aborting shape silently and forever — and
  // nothing in CI compared the two, which is why this class of defect could only
  // be found by hand-inspecting `pg_policy`.
  //
  // The assertion cannot live in a migration either: this script reports a
  // failing migration as SKIPPED and not fatal, so it has to run here, where CI
  // cannot swallow it. Detection itself lives in `scripts/rls-policy-shape.mjs`
  // so the unit and integration tests exercise the same pattern and the same
  // discovery floor that gate the build.
  let sweep;
  try {
    sweep = parseShapeSweep(
      execFileSync(
        'psql',
        [databaseUrl, '-t', '-A', '-F', '|', '-c', buildShapeSweepSql()],
        { stdio: 'pipe', timeout: 20000 },
      ).toString(),
    );
  } catch (e) {
    console.error(`\nERROR: could not evaluate the tenant_isolation policy shapes: ${String(e.message).slice(0, 120)}`);
    process.exit(1);
  }

  const shapeVerdict = evaluateShapeSweep(sweep);
  if (shapeVerdict.status !== 'pass') {
    console.error(`\nERROR: ${shapeVerdict.message} (#2438)`);
    process.exit(1);
  }
  console.log(`\nOK: ${shapeVerdict.message} (#2438)`);

  // #2232: surface the full isolation picture (enabled+forced, policy count,
  // NULL-tenant gaps) from the dedicated verifier. Non-fatal here: the CI
  // connection may legitimately own the schema, which the verifier flags.
  try {
    execSync('npx tsx scripts/verify-tenant-isolation.ts', {
      stdio: 'inherit',
      timeout: 120000,
      cwd: join(__dirname, '..'),
    });
  } catch (e) {
    console.warn(`[apply-rls-ci] verify-tenant-isolation reported gaps (non-fatal): ${String(e.message).slice(0, 120)}`);
  }

  console.log('\n✅ RLS migrations applied and verified');
}

main();
