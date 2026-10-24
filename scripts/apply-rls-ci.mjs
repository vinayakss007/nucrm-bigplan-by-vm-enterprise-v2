/**
 * Apply RLS migrations in CI (#2038).
 *
 * CI provisions the schema with `npm run db:sync` (drizzle-kit push),
 * which syncs only the TABLE structure. It does NOT run the hand-written
 * SQL migration files that create RLS objects. This script applies those
 * security migrations in journal order so integration tests can verify
 * row-level security — discovering them by what their SQL does (#3171), with
 * the old filename test kept as a union fallback.
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
//
// #3171: that regex is kept, but only as a FALLBACK. Matching on words like
// `polic`/`rls` in a *filename* is a proxy for content, and the two diverge —
// measured at `fdd42eaad`, 11 of the 23 files the name test let through the
// door carried no name match at all, and re-measured here at `04698d679`, the
// same class of miss is 15 files wide: `0098` tenant-hierarchy party access,
// `0099` API-key auth lookup, `0105` the email-tracking-pixel lookup, `0127`
// `segment_members` self-scope, `0131` super-admin usage read, `0042`'s
// audit-purge TRIGGER (the reason #3165's suite could not demonstrate itself),
// and the `GRANT`/`REVOKE` statements in `0000`, `0002` and `0049`. A
// regression that deletes or narrows any of those objects is invisible to CI —
// the identical failure mode #2232 was filed for, one migration number later.
//
// So discovery asks the file what it does. The name test stays as the fallback
// the comment above describes: it is a union, never a subtraction, because
// dropping a file CI used to apply would take coverage away, and the five
// name-only matches (`0060`, `0066`, `0070`, `0086`, plus `0124` until its
// `DROP POLICY` became visible to the content test) cost nothing but a `skipped`
// line if they carry no security SQL.
export const RLS_TAG_RE = /rls|isolation|polic|bypass|member_read|tenant_reference|force_/i;

/**
 * The security objects themselves. `ALTER`/`DROP POLICY` and `DROP TRIGGER` are
 * in here on purpose: a migration that REMOVES a security object has to run in
 * CI too, or the provisioned database keeps a policy production retired.
 */
export const SECURITY_SQL_RE =
  /CREATE POLICY|ALTER POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY|GRANT|REVOKE|SECURITY DEFINER|CREATE (OR REPLACE )?TRIGGER|DROP TRIGGER/i;

/**
 * Measured at `04698d679`: 132 up-migrations, 34 carrying security SQL, 38 in
 * the union. The floor sits far below the real number and far above a directory
 * that stopped existing, which is the only way this script can silently
 * provision a weaker database than it claims to.
 */
export const MIN_SECURITY_MIGRATIONS = 30;

/**
 * Blank `-- …` and `/* … *\/` to spaces, keeping every offset, so a header that
 * says "this table already has FORCE ROW LEVEL SECURITY" is not mistaken for
 * security SQL. Quoted literals are stepped over, and `''` inside one is an
 * escape rather than a close: `0109`, `0125` and `0129` are each included by
 * raw text and excluded by this, and they are exactly the kind of file whose
 * comment explains why it is NOT an RLS migration.
 */
export function stripSqlComments(sql) {
  const out = sql.split('');
  const n = sql.length;
  const blank = (from, to) => {
    for (let j = from; j < to && j < n; j++) if (out[j] !== '\n') out[j] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      let j = i;
      while (j < n && sql[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = i + 2;
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Does this migration's own SQL create, change or retire a security object? */
export function hasSecuritySql(sql) {
  return SECURITY_SQL_RE.test(stripSqlComments(sql));
}

/**
 * Classify one migration. Pure and exported so the unit test pins both
 * directions — the files the name test missed must come IN, and the files whose
 * only match is prose must stay OUT — against the real corpus, not a fixture.
 */
export function classifySecurityMigration(tag, sql) {
  const byContent = sql !== null && hasSecuritySql(sql);
  const byName = RLS_TAG_RE.test(tag);
  return { tag, byContent, byName, included: byContent || byName };
}

/** Journal order, oldest first — the same order `db:migrate` would use. */
export function sortByIdx(tags) {
  return [...tags].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

/**
 * The tags to apply, from `entries = [{ tag, sql }]` (`sql: null` when the file
 * cannot be read — the caller reports that as `missing`, not as a non-match).
 */
export function discoverSecurityTags(entries) {
  return sortByIdx(
    entries.filter((e) => classifySecurityMigration(e.tag, e.sql).included).map((e) => e.tag),
  );
}

function discoverRlsTags() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .map((tag) => {
      let sql = null;
      try {
        sql = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8');
      } catch {
        sql = null; // reported as `missing` when the loop reaches it
      }
      return { tag, sql };
    });
}

const MIGRATION_ENTRIES = discoverRlsTags();
const RLS_MIGRATION_TAGS = discoverSecurityTags(MIGRATION_ENTRIES);
const CLASSIFIED = new Map(
  MIGRATION_ENTRIES.map((e) => [e.tag, classifySecurityMigration(e.tag, e.sql)]),
);
if (RLS_MIGRATION_TAGS.length === 0) {
  console.error('[apply-rls-ci] security-migration discovery matched zero migrations — pattern or migrations dir broken');
  process.exit(1);
}
if (RLS_MIGRATION_TAGS.length < MIN_SECURITY_MIGRATIONS) {
  console.error(
    `[apply-rls-ci] discovery matched ${RLS_MIGRATION_TAGS.length} migration(s); expected at least ` +
    `${MIN_SECURITY_MIGRATIONS} — the migrations dir moved or the content test stopped working, ` +
    'and a CI database provisioned by nothing looks exactly like one provisioned correctly (#3171)',
  );
  process.exit(1);
}

function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const results = [];

  console.log(
    `[apply-rls-ci] ${RLS_MIGRATION_TAGS.length}/${MIGRATION_ENTRIES.length} up-migrations carry ` +
    `security objects — ${RLS_MIGRATION_TAGS.filter((t) => CLASSIFIED.get(t)?.byContent).length} by SQL content, ` +
    `${RLS_MIGRATION_TAGS.filter((t) => !CLASSIFIED.get(t)?.byContent).length} by filename only (#3171)`,
  );

  for (const tag of RLS_MIGRATION_TAGS) {
    const upPath = join(migrationsDir, `${tag}.sql`);
    const why = CLASSIFIED.get(tag)?.byContent ? 'content' : 'filename';

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
      results.push({ tag, status: 'applied', detail: `migration executed (matched by ${why})` });
    } catch (_e) {
      // Some migrations reference tables/columns that don't exist after db:sync
      results.push({ tag, status: "skipped", detail: `matched by ${why}: ${_e.message.slice(0, 60)}` });
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

// The classifier is exported for `tests/unit/apply-rls-ci-content-discovery-3171.test.ts`,
// which pins the discovery set against the real migrations directory; running the
// module must not also provision a database, so `main()` is guarded the way
// `check-migration-rls-dml.mjs` guards it.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
