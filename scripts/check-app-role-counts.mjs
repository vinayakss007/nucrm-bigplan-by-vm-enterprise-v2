#!/usr/bin/env node
/**
 * #3280 — every read of an RLS-filtered table has to say which context it read in.
 *
 * `DATABASE_URL` is `nucrm_app`: not the table owner, not a superuser, no
 * `BYPASSRLS`. That role is subject to Row Level Security wherever it is enabled —
 * measured on the live schema, 226 tables, 226 enabled, 0 owned by `nucrm_app` — so
 * a session that declares neither `app.current_tenant` nor `app.is_super_admin` is
 * admitted to no rows and does not raise. 0 of 28 users, 0 of 66 contacts, 0 of 146
 * deal stages, all measured. Nothing distinguishes those reads from the honest ones
 * at the call site, and that is the bug: eight operational scripts drew confident,
 * wrong conclusions from a zero they had never been permitted to see, and this PR
 * arms them — `drift-check` called a populated orphan table safe to drop,
 * `bootstrap.sh` told the operator no super admin existed, both restore verifiers
 * printed `users rows = 0` as proof a restore was good, `db:diagnose` offered "safe
 * to rebuild from scratch" for a database holding customer data, the jsonb byte audit
 * reported no overage, and the two seed scripts re-created identities that already
 * existed. `db:state`, which is where the report started, had already been armed by
 * #3314; `npm run db:count` is the loud version for any single table.
 *
 * This screen reads the ops scripts, not the database, so it runs on every pull
 * request:
 *
 *   DENOMINATOR     every table `drizzle/schema/` declares, minus the ones a
 *                   standing `FOR SELECT USING (true)` policy makes readable from
 *                   any session (17 of them, read honestly unarmed). Derived by
 *                   scripts/lib/rls-filtered-tables.mjs, so a new tenant table
 *                   extends this screen by itself.
 *   UNARMED_READ    a file under `scripts/` that names one of those tables in a
 *                   read — SQL text (`from users`, `join "deal_stages"`) or
 *                   Drizzle (`from(dealStages)`) — and contains nothing that arms a
 *                   context: neither the GUC names (`app.current_tenant`,
 *                   `app.is_super_admin`), nor `set_config`/`PGOPTIONS`, nor a
 *                   `with…Context(` / `withReadonlySession(` call, nor `inContext(`.
 *
 * Granularity is honest about its limit: ARMING IS A FILE-LEVEL FACT. A script that
 * arms one query is treated as armed for all of them, which is what makes the rule
 * checkable without a database. Per-query analysis would need the statement and its
 * transaction to be resolved together — `npm run db:count -- <table>` is the tool
 * that does show both contexts, and the reason this repository's counts should never
 * be quoted without naming one.
 *
 * Scope is `scripts/` by design: `app/` and `lib/` are screened by `guard:rls`,
 * which resolves the request's tenant context per route.
 *
 * Escape hatch: an entry in scripts/app-role-counts-baseline.json —
 * `{ "file": "scripts/<name>", "reason": "…" }`, reason at least 20 characters.
 * Shrink-only: a baseline entry that no longer matches a violation, names a missing
 * file, or duplicates another file is itself a failure.
 *
 * Usage: node scripts/check-app-role-counts.mjs [tree] [--json] [--baseline <path>]
 * Exit: 0 clean, 1 findings, 2 could not run.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { rlsFilteredTables } from './lib/rls-filtered-tables.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASELINE = 'scripts/app-role-counts-baseline.json';
const SCAN_DIR = 'scripts';
const EXTENSIONS = /\.(ts|mts|tsx|mjs|js|cjs|sh)$/;
const MIN_REASON_LENGTH = 20;

/** Anything that makes a session's reads mean something. */
const ARMING_SIGNALS = [
  'app.current_tenant',
  'app.is_super_admin',
  'set_config',
  'PGOPTIONS',
  'inContext(',
];
const ARMING_HELPER = /\bwith[A-Za-z]*(?:Context|Session)\s*\(/;

/** `FROM`/`INTO`/`UPDATE`/`JOIN` of the table, optionally schema- or quote-wrapped. */
const readInSqlText = (table) =>
  new RegExp(`\\b(?:from|into|update|join)\\s+(?:"[a-z_][a-z0-9_]*"\\s*\\.\\s*)?"?${table}"?\\b`, 'i');

/** Drizzle's builder form: `db.select().from(users)`, `tx.insert(invoiceLineItems)`. */
const readInBuilderForm = (table) => {
  const ident = table.replace(/_(\w)/g, (_, c) => c.toUpperCase());
  return new RegExp(`\\b(?:from|update|insert|delete)\\s*\\(\\s*(?:${table}|${ident})\\b`);
};

const at = (p) => (p === undefined ? undefined : (isAbsolute(p) ? p : join(ROOT, p)));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXTENSIONS.test(name)) yield p;
  }
}

function armedBy(text) {
  const signals = ARMING_SIGNALS.filter((s) => text.includes(s));
  const helper = ARMING_HELPER.exec(text);
  if (helper) signals.push(helper[0].replace(/\s*\($/, ''));
  return signals;
}

function touchedTables(text, tables) {
  return tables.filter((t) => readInSqlText(t).test(text) || readInBuilderForm(t).test(text));
}

/**
 * @param {{ root?: string, tables?: string[] }} opts
 * @returns {{ violations: {file: string, tables: string[]}[], scanned: number, tables: string[] }}
 */
export function scan(opts = {}) {
  const root = opts.root ?? ROOT;
  const tables = opts.tables
    ?? rlsFilteredTables({
      schemaDir: join(root, 'drizzle/schema'),
      migrationsDir: join(root, 'drizzle/migrations'),
    });
  const violations = [];
  let scanned = 0;
  for (const file of walk(join(root, SCAN_DIR))) {
    const text = readFileSync(file, 'utf8');
    scanned++;
    if (/app-role-counts: allow/.test(text)) continue;
    const hits = touchedTables(text, tables);
    if (!hits.length || armedBy(text).length) continue;
    violations.push({ file: relative(root, file).split('\\').join('/'), tables: hits });
  }
  return { violations, scanned, tables };
}

function readBaseline(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(raw.exempt) ? raw.exempt : [];
}

/** A baseline that no longer costs anything is a bug report, not a tolerance. */
export function reconcile(baseline, violations, root = ROOT) {
  const problems = [];
  const byFile = new Map();
  for (const entry of baseline) {
    const file = String(entry?.file ?? '');
    const reason = String(entry?.reason ?? '');
    if (byFile.has(file)) problems.push({ code: 'BASELINE_DUPLICATE', file });
    byFile.set(file, entry);
    if (reason.length < MIN_REASON_LENGTH) problems.push({ code: 'BASELINE_NO_REASON', file });
    if (!existsSync(join(root, file))) problems.push({ code: 'BASELINE_MISSING_FILE', file });
  }
  for (const v of violations) {
    if (!byFile.has(v.file)) continue;
    const covered = String(byFile.get(v.file).tables ?? '');
    const uncovered = v.tables.filter((t) => !covered.split(',').includes(t));
    if (uncovered.length) problems.push({ code: 'BASELINE_INCOMPLETE', file: v.file, tables: uncovered });
  }
  for (const entry of baseline) {
    if (!violations.some((v) => v.file === entry.file)) {
      problems.push({ code: 'BASELINE_STALE', file: String(entry.file ?? '') });
    }
  }
  return problems;
}

function baselinePathFrom(argv) {
  const i = argv.indexOf('--baseline');
  const value = i === -1 ? undefined : argv[i + 1];
  if (i !== -1 && (value === undefined || value.startsWith('--'))) {
    throw new Error('--baseline needs a path');
  }
  return { index: i, path: at(value ?? DEFAULT_BASELINE) };
}

/** `check-app-role-counts.mjs [tree]` — the tree to scan, default this repository. */
function rootFrom(argv, baselineValueIndex) {
  const i = argv.findIndex((a, j) => !a.startsWith('--') && j !== baselineValueIndex);
  return i === -1 ? ROOT : at(argv[i]);
}

export function main(argv = process.argv.slice(2)) {
  let baselinePath;
  let baselineValueIndex = -1;
  try {
    const parsed = baselinePathFrom(argv);
    baselinePath = parsed.path;
    baselineValueIndex = parsed.index === -1 ? -1 : parsed.index + 1;
  } catch (err) {
    console.error(`[check-app-role-counts] ${err.message}`);
    return 2;
  }
  const root = rootFrom(argv, baselineValueIndex);
  const json = argv.includes('--json');

  let result;
  try {
    result = scan({ root });
  } catch (err) {
    console.error(`[check-app-role-counts] cannot run: ${err.message}`);
    return 2;
  }
  let baseline;
  try {
    baseline = existsSync(baselinePath) ? readBaseline(baselinePath) : [];
  } catch (err) {
    console.error(`[check-app-role-counts] baseline is not readable JSON: ${err.message}`);
    return 2;
  }
  const problems = reconcile(baseline, result.violations, root);
  const findings = result.violations.filter((v) => !baseline.some((b) => b.file === v.file));

  if (json) {
    process.stdout.write(`${JSON.stringify({
      rlsFilteredTables: result.tables.length,
      scanned: result.scanned,
      findings,
      problems,
      tolerated: baseline.length,
    }, null, 2)}\n`);
    return findings.length || problems.length ? 1 : 0;
  }

  if (findings.length) {
    console.error(`[check-app-role-counts] ${findings.length} script(s) read an RLS-filtered table with no RLS context (#3280):`);
    for (const f of findings) console.error(`  - ${f.file}: ${f.tables.join(', ')}`);
    console.error('  Arm the context the policy reads (withSecurityContext / withTenantContext /');
    console.error('  set_config of app.current_tenant or app.is_super_admin), or count through');
    console.error('  `npm run db:count -- <table>`, which prints both contexts side by side.');
  }
  for (const p of problems) {
    console.error(`[check-app-role-counts] baseline ${p.code}: ${p.file}${p.tables ? ` (${p.tables.join(', ')})` : ''}`);
  }
  if (findings.length || problems.length) return 1;

  console.log(`[check-app-role-counts] OK — ${result.scanned} script files scanned against ${result.tables.length} RLS-filtered tables; 0 un-armed reads, ${baseline.length} tolerated.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
