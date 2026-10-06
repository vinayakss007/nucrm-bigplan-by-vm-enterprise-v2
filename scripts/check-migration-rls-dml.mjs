/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Migration row-DML / RLS guard (PP-058).
 *
 * WHY
 * ---
 * `scripts/migrate.ts` connects with a bare `new Pool({ connectionString })`
 * (`:184-185`) and never issues `set_config` anywhere in the file. Its role is
 * `nucrm`: `rolsuper=false`, `rolbypassrls=false`, and the OWNER of the tables
 * — which is exactly the case `FORCE ROW LEVEL SECURITY` exists to catch, so
 * the owner does not bypass RLS here. `app.current_tenant` is unset for the
 * whole run, `NULLIF(current_setting('app.current_tenant', true), '')::uuid`
 * is NULL, and every tenant policy evaluates false.
 *
 * RLS filters DML but not DDL. A migration shaped "repair the rows, then
 * constrain them" therefore repairs ZERO rows and then aborts on the real data,
 * because `CREATE UNIQUE INDEX` and `SET NOT NULL` read the whole heap
 * regardless of any policy. PP-058 measured this on preprod: `0114` dedupes 0
 * of 4 known loser rows and the run dies on 23505, which is why 21 journal
 * entries cannot advance past `0113`.
 *
 * CI CANNOT SEE THIS CLASS AT ALL
 * ------------------------------
 * `.github/workflows/ci.yml` runs `node scripts/apply-rls-ci.mjs` with
 * `DATABASE_URL=postgresql://postgres:postgres@…` — the superuser. RLS is not
 * enforced against a superuser, so the same file that is a silent no-op in
 * production succeeds in CI, and the difference is invisible to every test.
 * That is why this check is static: it is the only place the two contexts can
 * be compared without a production-equivalent role.
 *
 * THE RULE
 * --------
 * If a migration file's *executable* scope writes rows into a tenant-scoped
 * table, it must also set the super-admin GUC those policies already branch on
 * (`0088` gates several policies on it — see `rls_bootstrap_and_isolation`):
 *
 *     PERFORM set_config('app.is_super_admin', 'true', true);
 *
 * `true` as the third argument makes it transaction-local, so it cannot leak
 * into later files in the run. `0109_webhook_events_created_at_not_null.sql`
 * is the worked example, and the only one of 120 files that does it.
 *
 * WHAT "TENANT-SCOPED" MEANS HERE (static, no DB)
 * -----------------------------------------------
 * Derived from the migration history itself, as the union of:
 *   (a) tables with a `CREATE POLICY` whose expression reads
 *       `current_setting('app.current_tenant', ...)`, and
 *   (b) tables declared with a `tenant_id` column (CREATE TABLE / ADD COLUMN).
 * (b) is not redundant. Policy text is frequently built by `format()`/`EXECUTE`
 * loops, so (a) alone misses tables that are isolated in the live DB — `leads`
 * is the proof: PP-058 measured it `rls_enabled` + `rls_forced`, yet no literal
 * `CREATE POLICY … ON leads` mentions the GUC. Only (b) flags it, and (b) alone
 * would miss policy-bearing tables with no tenant_id column.
 *
 * SCOPE HONESTY — what this guard does NOT cover
 * ---------------------------------------------
 *   * `CREATE FUNCTION` bodies are excluded (they do not execute at migration
 *     time), so writes performed later by a trigger or a SECURITY INVOKER
 *     function are outside its view;
 *   * a *read* used as a guard is invisible to it: a `DO` block that counts
 *     rows and `RAISE`s an exception (`0107`, `0108`) contains no DML at all,
 *     yet its promised diagnostic is equally inert under the same blind
 *     context. Naming that reliably needs dataflow, not a regex, so it is left
 *     to review rather than guessed at here;
 *   * the root defect is the runner's connection context, which is PP-058's
 *     open decision (#103). This guard stops NEW migrations from joining the
 *     set; it does not repair the existing ones.
 *
 * Known offenders are baselined — the ratchet pattern used by `guard:filesize`
 * and `guard:chain` — so this can be wired into CI today. Fixing one prints a
 * hint to shrink the baseline. The ratchet is *file*-granular: an entry
 * already in the baseline may change its write set without failing, so this
 * stops new offenders from appearing, it does not police the existing 19.
 *
 * Regenerate after a deliberate repair:
 *   node scripts/check-migration-rls-dml.mjs --update
 *
 * `--migrations-dir <path>` and `--baseline <path>` exist so the exit-code
 * contract can be exercised against fixtures rather than only the real tree;
 * `tests/unit/migration-rls-dml-guard.test.ts` uses them for exactly that.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_MIGRATIONS_DIR = 'drizzle/migrations';
const DEFAULT_BASELINE_PATH = 'scripts/migration-rls-dml-baseline.json';
const MITIGATION = /set_config\(\s*'app\.is_super_admin'/i;

/** Strip block and line comments so prose in a migration header cannot match a rule. */
export function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/**
 * Body regions of dollar-quoted blocks, outermost only.
 *
 * `DO $$ … $$` and `CREATE FUNCTION … $function$ … $function$` are the same
 * syntactic construct with different tags, and the repo uses both — splitting
 * on the literal `$$` alone leaves every tagged body in scope, which reads as
 * dozens of writes that never run at migration time. Postgres forbids reusing
 * a tag for nesting, so a stack that pops on an identical tag is exact.
 */
function dollarQuoteBodies(sql) {
  const delim = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  const stack = [];
  const bodies = [];
  let m;
  while ((m = delim.exec(sql)) !== null) {
    const tag = m[0];
    if (stack.length > 0 && stack.at(-1).tag === tag) {
      const open = stack.pop();
      // `open` is the position of the opening delimiter, `m.index` the closing
      // one; everything between them is the block's body.
      if (stack.length === 0) bodies.push({ open: open.at, end: m.index });
    } else {
      stack.push({ tag, at: m.index });
    }
  }
  return bodies;
}

/**
 * Keep the scopes that execute at migration time, drop the ones that do not.
 * A `DO` block runs now; a `CREATE FUNCTION … AS <quote>` body is a stored
 * routine, executed only when something later calls it.
 *
 * The introducing statement is taken from the kept text since the last `;`,
 * not from a fixed character window: several files in `drizzle/migrations`
 * (`0032` is one) are whitespace-padded to ~160 columns, so 240 characters
 * back only reaches `LANGUAGE plpgsql` and never finds `CREATE FUNCTION`.
 */
export function executableScope(sql) {
  let out = '';
  let tail = '';
  let cursor = 0;
  for (const b of dollarQuoteBodies(sql)) {
    // The preamble must stop AT the opening delimiter — including the
    // delimiter and the first words of the body would end every test below
    // inside the block it is supposed to classify.
    tail += sql.slice(cursor, b.open);
    const stmt = tail.slice(tail.lastIndexOf(';') + 1);
    const isStoredFunctionBody
      = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(stmt) && /\bAS\s*$/i.test(stmt);
    out += tail;
    tail = '';
    if (!isStoredFunctionBody) out += sql.slice(b.open, b.end);
    cursor = b.end;
  }
  return out + tail + sql.slice(cursor);
}

/** Every `CREATE POLICY … ON <table>` as `[table, statementText]`. */
export function policyStatements(sql) {
  const out = [];
  const re = /CREATE\s+POLICY\s+(?:"[^"]*"|[\w$]+)\s+ON\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"*/gi;
  for (const m of sql.matchAll(re)) {
    // A policy body contains no top-level `;`, so the first one ends it.
    const end = sql.indexOf(';', m.index);
    out.push([m[1], end === -1 ? sql.slice(m.index) : sql.slice(m.index, end + 1)]);
  }
  return out;
}

/**
 * The column list of the `(` at `open`, up to its matching `)`, with
 * single-quoted literals skipped (`''` is an escaped quote). Depth counting
 * rather than a lazy `\)...` regex, because a body legitimately contains
 * parens — `numeric(19,2)`, `CHECK (x > 0)` — and a lazy match would end at the
 * first one and silently drop whatever came after it.
 */
function readBalancedParens(sql, open) {
  let depth = 0;
  let inString = false;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (inString) {
      if (c === "'") {
        if (sql[i + 1] === "'") i++;
        else inString = false;
      }
      continue;
    }
    if (c === "'") inString = true;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return null; // unbalanced — caller treats it as "nothing derived", never as a match
}

/**
 * `CREATE TABLE` bodies that declare a `tenant_id` column. Input must already
 * be comment-stripped (as `collectTenantScoped` does): an unmatched paren in a
 * comment would throw the depth scan off, in both directions.
 */
export function createTableTenantNames(sql) {
  const out = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w]+"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    // `matchAll` iterates a *clone* of the regex, so `re.lastIndex` never moves
    // — the opening paren is at the end of the match itself.
    const body = readBalancedParens(sql, m.index + m[0].length - 1);
    if (body !== null && /\btenant_id\b/i.test(body)) out.add(m[1]);
  }
  return out;
}

/** Tables the migration history itself declares tenant-scoped. */
export function collectTenantScoped(sqlOfAllFiles) {
  const byPolicy = new Set();
  const byColumn = new Set();
  for (const sql of sqlOfAllFiles.map(stripComments)) {
    for (const [table, stmt] of policyStatements(sql)) {
      if (/current_setting\(\s*'app\.current_tenant'/i.test(stmt)) byPolicy.add(table);
    }
    for (const table of createTableTenantNames(sql)) byColumn.add(table);
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:[\w.]+\.)?"?([a-z_][a-z0-9_]*)"?\s+ADD\s+COLUMN\s+"?tenant_id"?/gi)) {
      byColumn.add(m[1]);
    }
  }
  return { byPolicy, byColumn, tenantScoped: new Set([...byPolicy, ...byColumn]) };
}

const DML_PATTERNS = [
  ['update', /\bUPDATE\s+(?:ONLY\s+)?(?:[\w.]+\.)?"?([a-z_][a-z0-9_]*)"?\s+(?:\w+\s+)?SET\b/gi],
  ['delete', /\bDELETE\s+FROM\s+(?:[\w.]+\.)?"?([a-z_][a-z0-9_]*)"?\b/gi],
  ['insert', /\bINSERT\s+INTO\s+(?:[\w.]+\.)?"?([a-z_][a-z0-9_]*)"?\b/gi],
];

/**
 * Verdict on one migration file: the rows it writes at migration time, per
 * target table, plus whether it writes through dynamic SQL (no static target).
 */
export function analyzeFile(rawSql, tenantScoped) {
  const mitigated = MITIGATION.test(rawSql);
  const scoped = executableScope(stripComments(rawSql));
  const writes = [];
  for (const [kind, re] of DML_PATTERNS) {
    for (const m of scoped.matchAll(re)) writes.push({ kind, table: m[1] });
  }
  // `EXECUTE format('UPDATE %I …')` has no static target, but its loop names
  // the tables as quoted identifiers. Treat it as "unknown target" so a file
  // doing this is never silently clean.
  const dynamic = /\bEXECUTE\s+(?:format\s*\(\s*)?'[^']*\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i.test(scoped);
  const tenantWrites = writes.filter((w) => tenantScoped.has(w.table));
  const dynamicOverTenantTable = dynamic
    && [...tenantScoped].some((t) => new RegExp(`["']${t}["']`).test(scoped));
  return { mitigated, writes, tenantWrites, dynamic, dynamicOverTenantTable };
}

function collect(migrationsDir) {
  const names = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
  const rawOf = names.map((f) => readFileSync(`${migrationsDir}/${f}`, 'utf8'));
  const { byPolicy, byColumn, tenantScoped } = collectTenantScoped(rawOf);

  const violations = { atRisk: [], dynamicTarget: [] };
  names.forEach((name, i) => {
    const tag = name.replace(/\.sql$/, '');
    const a = analyzeFile(rawOf[i], tenantScoped);
    if (a.mitigated) return;
    if (a.tenantWrites.length > 0) {
      const listed = [...new Set(a.tenantWrites.map((w) => `${w.kind}:${w.table}`))].sort().join(' ');
      violations.atRisk.push(`atRisk:${tag}|${listed}`);
    } else if (a.dynamicOverTenantTable) {
      violations.dynamicTarget.push(`dynamicTarget:${tag}`);
    }
  });

  for (const k of Object.keys(violations)) violations[k] = [...new Set(violations[k])].sort();
  return {
    counts: {
      files: names.length,
      tenantScoped: tenantScoped.size,
      byPolicy: byPolicy.size,
      byColumn: byColumn.size,
    },
    violations,
  };
}

const KINDS = ['atRisk', 'dynamicTarget'];

// `--migrations-dir` / `--baseline` exist so the CLI contract — exit 0 clean,
// exit 1 on a new offender, exit 0 once mitigated — is testable against
// fixtures instead of only against the 120 real files.
function resolvePaths(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  return {
    migrationsDir: flag('--migrations-dir') ?? DEFAULT_MIGRATIONS_DIR,
    baselinePath: flag('--baseline') ?? DEFAULT_BASELINE_PATH,
  };
}

function main() {
  const { migrationsDir, baselinePath } = resolvePaths(process.argv);
  const { counts, violations } = collect(migrationsDir);
  const flat = KINDS.flatMap((k) => violations[k]);

  if (process.argv.includes('--update')) {
    const body = {
      _comment: 'Migrations that write rows into tenant-scoped tables without setting the app.is_super_admin GUC those RLS policies branch on (PP-058). scripts/migrate.ts runs on a bare pool with no app.current_tenant and FORCE RLS removes the owner bypass, so those writes match ZERO rows: the repair is a silent no-op while CREATE UNIQUE INDEX / SET NOT NULL still see the real data, and the deploy aborts. CI cannot catch this — apply-rls-ci.mjs runs the same files as the postgres superuser, which RLS does not filter. Shrink this baseline as files are fixed; the guard fails on any NEW offender. Regenerate: node scripts/check-migration-rls-dml.mjs --update',
      counts,
      violations,
    };
    writeFileSync(baselinePath, JSON.stringify(body, null, 2) + '\n');
    console.log(`[check-migration-rls-dml] baseline written with ${flat.length} known offender(s)`);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch {
    console.error(`[check-migration-rls-dml] no baseline at ${baselinePath} — run: node scripts/check-migration-rls-dml.mjs --update`);
    process.exit(1);
  }

  const known = [...(baseline.violations?.atRisk ?? []), ...(baseline.violations?.dynamicTarget ?? [])];
  const keyOf = (v) => v.split('|')[0];
  const knownKeys = new Set(known.map(keyOf));
  const freshKeys = new Set(flat.map(keyOf));
  const fresh = flat.filter((v) => !knownKeys.has(keyOf(v)));
  const healed = known.filter((v) => !freshKeys.has(keyOf(v)));

  console.log([
    `[check-migration-rls-dml] ${counts.files} migration(s) · ${counts.tenantScoped} tenant-scoped table(s)`,
    `                     policy-derived ${counts.byPolicy} ∪ tenant_id-column ${counts.byColumn}`,
    `  baselined: ${(baseline.violations?.atRisk ?? []).length} row-write offender(s), ${(baseline.violations?.dynamicTarget ?? []).length} dynamic-target file(s)`,
  ].join('\n'));

  if (healed.length > 0) {
    console.log(`  ..   ${healed.length} baselined offender(s) are gone — shrink the baseline:`);
    for (const v of healed) console.log(`       - ${v}`);
    console.log('       node scripts/check-migration-rls-dml.mjs --update');
  }

  if (fresh.length > 0) {
    console.error(`  ${fresh.length} NEW RLS-blind write(s):`);
    for (const v of fresh) console.error(`   x ${v}`);
    console.error([
      '',
      'scripts/migrate.ts runs on a bare pool with no app.current_tenant, and every',
      'tenant table is FORCE ROW LEVEL SECURITY — so the owner does not bypass RLS',
      'here and these statements match zero rows (PP-058). The repair is then a',
      'silent no-op while CREATE UNIQUE INDEX / SET NOT NULL still see the real',
      'data, and the run aborts mid-deploy. CI will not catch it either:',
      'apply-rls-ci.mjs applies these files as the postgres superuser.',
      '',
      "Set the GUC the policies already branch on, transaction-locally, in the",
      'same DO block as the write — see 0109_webhook_events_created_at_not_null.sql:',
      '',
      "    PERFORM set_config('app.is_super_admin', 'true', true);",
      '',
      'Do NOT add an entry to the baseline without a reason in the PR that does so.',
    ].join('\n'));
    process.exit(1);
  }

  console.log('[check-migration-rls-dml] OK — no new RLS-blind writes.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
