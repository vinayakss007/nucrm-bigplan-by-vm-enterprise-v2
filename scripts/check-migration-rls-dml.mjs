/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Migration row-DML / RLS guard (PP-058; per-table resolution added by #2516).
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
 * entries cannot advance past `0113`. PP-067 measured the same shape again on
 * `0125`: `set_config('app.is_super_admin','true',true)` reports `UPDATE 0` on
 * the tables whose policies do not read that GUC.
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
 * THE RULE — per table, not per file (#2516)
 * ------------------------------------------
 * For every tenant-scoped table a file's *executable* scope writes, ask what
 * the chain's policies leave on THAT table and whether the GUCs the file sets
 * can satisfy one of them (`scripts/rls-policy-map.mjs` does the reading):
 *
 *   * the file sets `app.current_tenant` → accepted. Every policy generator in
 *     the chain, literal or looped, gates on it, so a file that establishes the
 *     tenant context per tenant is never the file this guard exists to catch;
 *   * else some attributable PERMISSIVE policy for that write kind either
 *     reads no GUC at all (`error_logs_insert_any WITH CHECK (true)`) or reads
 *     one the file sets → accepted, and the report names the policy;
 *   * else the write is RLS-blind and the file fails, with the reason printed.
 *
 * `app.is_super_admin` is therefore worth nothing on its own: it is worth what
 * the policies of the table being written happen to read. `0109` sets it and is
 * correct, because `webhook_events`' `tenant_isolation` ORs on it — ledger rows
 * are cross-tenant (NULL `tenant_id`), so `app.current_tenant` would see none of
 * them. `custom_entities`, `custom_entity_data` and `segment_members` gate on
 * `app.current_tenant` ONLY; a migration that writes those and sets only the
 * marker is blind, and `0125` passes today purely because it *also* loops
 * `set_config('app.current_tenant', t.id::text, true)` per tenant.
 *
 * WHY THE OLD RULE WAS WRONG (#2516)
 * ----------------------------------
 * It was one regex over the raw file text plus an early return:
 *
 *     const MITIGATION = /set_config\(\s*'app\.is_super_admin'/i;
 *     … if (a.mitigated) return;             // whole file judged clean
 *
 * Three separate defects, all measurable:
 *   1. file-global — the marker was treated as a licence for every write in the
 *      file, so the three tables above were reported clean by a line of SQL that
 *      cannot affect them. Evidence about a file is not evidence about a table.
 *   2. unstripped text — `MITIGATION.test(rawSql)` ran before `stripComments`,
 *      so a header comment *naming* the fix satisfied it. Every other rule in
 *      the file had already learned that lesson (`0114`'s header describes an
 *      UPDATE it does not perform).
 *   3. no table in the loop — the reverse error too: `0109` passed for a reason
 *      the guard never checked, so if a future `DROP POLICY` or a rewritten
 *      `tenant_isolation` removes the super-admin branch from `webhook_events`,
 *      the guard keeps saying "OK" while production starts saying `UPDATE 0`.
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
 * CORPUS ORDER IS EXECUTION ORDER
 * -------------------------------
 * `scripts/migrate.ts:143` iterates `journal.entries`, not the directory
 * listing, and the two disagree: 20 of 126 journal positions differ from the
 * sorted filenames, because `0091_usage_snapshots_superadmin_bypass` and
 * `0092_metrics_tables_superadmin_bypass` are applied after `0112`. Reading the
 * chain in filename order therefore attributes the wrong *last* policy to those
 * tables — `deal_stages.tenant_isolation` is written last by `0092` (both GUCs),
 * not by `0107` (`app.current_tenant` only). Last-writer-wins is only correct
 * if "last" means journal-last, so `orderedCorpus()` reads the journal.
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
 *   * policies created by a catalogue-driven loop (`FOR rec IN SELECT … FROM
 *     pg_attribute WHERE attname = 'tenant_id'`, `0037`/`0039`) have no static
 *     target. They are recorded as `ambientLoops` and never count as evidence
 *     *for* a table — a write into a table with nothing attributable is judged
 *     blind unless it sets `app.current_tenant`, which is conservative in the
 *     direction that matters;
 *   * the live DB is the truth and this is a screen over SQL text. The tradeoff
 *     is deliberate: a `pg_policies` read would be exact, but CI has no
 *     production-equivalent role, migrations are the thing under review, and a
 *     guard that needs a database cannot gate the commit that adds the database
 *     step. `scripts/rls-policy-shape.mjs` remains the live-DB sweep.
 *   * the root defect is the runner's connection context, which is PP-058's
 *     open decision (#103). This guard stops NEW migrations from joining the
 *     set; it does not repair the existing ones.
 *
 * Known offenders are baselined — the ratchet pattern used by `guard:filesize`
 * and `guard:chain` — so this can be wired into CI today. Fixing one prints a
 * hint to shrink the baseline. The ratchet is *file*-granular: an entry already
 * in the baseline may change its write set without failing, so this stops new
 * offenders from appearing, it does not police the existing 19.
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

import {
  TENANT_GUC,
  setGucs,
  resolvePolicyMap,
  writeIsVisible,
} from './rls-policy-map.mjs';

const DEFAULT_MIGRATIONS_DIR = 'drizzle/migrations';
const DEFAULT_BASELINE_PATH = 'scripts/migration-rls-dml-baseline.json';

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

/**
 * The corpus in the order the runner applies it.
 *
 * Journal-first, then any file on disk that the journal does not list (sorted,
 * so a fixture without a `meta/_journal.json` still works). A missing or
 * unreadable journal is not an error — it degrades to filename order, which is
 * what this guard did before #2516 and what every fixture directory uses.
 */
export function orderedCorpus(migrationsDir) {
  const onDisk = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
  const rawOf = new Map(onDisk.map((f) => [f, readFileSync(`${migrationsDir}/${f}`, 'utf8')]));
  let journal = null;
  try {
    journal = JSON.parse(readFileSync(`${migrationsDir}/meta/_journal.json`, 'utf8'));
  } catch {
    journal = null;
  }
  const ordered = [];
  const taken = new Set();
  for (const entry of journal?.entries ?? []) {
    const f = `${entry.tag}.sql`;
    if (!rawOf.has(f) || taken.has(f)) continue;
    taken.add(f);
    ordered.push({ file: f, sql: rawOf.get(f) });
  }
  for (const f of onDisk) {
    if (taken.has(f)) continue;
    ordered.push({ file: f, sql: rawOf.get(f) });
  }
  return { ordered, journalEntries: (journal?.entries ?? []).length, unlisted: onDisk.length - taken.size };
}

/**
 * What the chain leaves on each table, in apply order. Scoped like a migration:
 * prose is not a policy and a stored function body does not run now — the same
 * two rules that keep writes honest keep `CREATE POLICY` lines honest.
 */
export function buildPolicyMap(ordered) {
  return resolvePolicyMap(
    ordered.map((o) => ({ file: o.file, sql: executableScope(stripComments(o.sql)) })),
  );
}

const DML_PATTERNS = [
  ['update', /\bUPDATE\s+(?:ONLY\s+)?(?:[\w.]+\.)?"?([a-z_][a-z0-9_]*)"?\s+(?:\w+\s+)?SET\b/gi],
  ['delete', /\bDELETE\s+FROM\s+(?:[\w.]+\.)?"?([a-z_][a-z0-9_]*)"?\b/gi],
  ['insert', /\bINSERT\s+INTO\s+(?:[\w.]+\.)?"?([a-z_][a-z0-9_]*)"?\b/gi],
];

/**
 * Verdict on one migration file: the rows it writes at migration time, per
 * target table, and of those which ones RLS cannot see given the GUCs it sets.
 *
 * `policyMap` may be omitted (a caller with no chain to read). Then the only
 * defensible answer is the tenant GUC, and everything else is reported blind —
 * never "assume the marker helped".
 */
export function analyzeFile(rawSql, tenantScoped, policyMap) {
  const scoped = executableScope(stripComments(rawSql));
  const gucs = setGucs(scoped);
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
  const blind = [];
  const admitted = [];
  for (const w of tenantWrites) {
    const verdict = policyMap
      ? writeIsVisible(policyMap, w.table, w.kind, gucs)
      : {
        ok: gucs.has(TENANT_GUC),
        // Without a map the only thing this can claim is the tenant context, so
        // it claims that `why` and nothing else — `describeAdmission` prints a
        // policy name for every other accept.
        why: gucs.has(TENANT_GUC)
          ? 'tenant-guc'
          : gucs.size === 0 ? 'no-guc-set' : 'policy-not-attributable',
        expected: [TENANT_GUC],
        seen: [...gucs],
      };
    if (!verdict.ok) blind.push({ ...w, ...verdict });
    else admitted.push({ ...w, ...verdict });
  }
  return {
    gucs,
    writes,
    tenantWrites,
    blind,
    admitted,
    dynamic,
    dynamicOverTenantTable,
    dynamicBlind: dynamicOverTenantTable && !gucs.has(TENANT_GUC),
  };
}

/**
 * One resolved write, named. `#2545` AC3: a write the screen excuses has to say
 * *which* policy excuses it, because "no violation" and "admitted by a policy
 * that reads nothing" are the same exit code and not the same fact.
 */
function describeAdmission(w) {
  if (w.why === 'tenant-guc') return `${w.kind} ${w.table}: ${TENANT_GUC} is set, which every tenant policy is built on`;
  if (w.policyGucs.length === 0) return `${w.kind} ${w.table}: admitted by policy "${w.policy}", which reads no GUC at all`;
  return `${w.kind} ${w.table}: admitted by policy "${w.policy}", which reads ${w.policyGucs.join(', ')}`;
}

const REASON_TEXT = {
  'no-guc-set': (w) => `${w.kind} ${w.table}: sets no GUC, and ${w.table}'s ${w.kind} policies read ${w.expected.join(', ')}`,
  'guc-not-gated-here': (w) => `${w.kind} ${w.table}: sets ${w.seen.join(', ')}, but ${w.table}'s ${w.kind} policies read only ${w.expected.join(', ')} — the marker is not a licence for this table`,
  'policy-not-attributable': (w) => `${w.kind} ${w.table}: no literal CREATE POLICY or literal ARRAY loop names a ${w.kind} policy for it, so only ${TENANT_GUC} can prove the rows are visible`,
  'restrictive-policy-gate': (w) => `${w.kind} ${w.table}: a RESTRICTIVE policy gates on ${w.expected.join(', ')}, which this file does not set`,
};

function describeReason(w) {
  const f = REASON_TEXT[w.why];
  return f ? f(w) : `${w.kind} ${w.table}: ${w.why}`;
}

function collect(migrationsDir) {
  const { ordered, journalEntries, unlisted } = orderedCorpus(migrationsDir);
  const { byPolicy, byColumn, tenantScoped } = collectTenantScoped(ordered.map((o) => o.sql));
  const policyMap = buildPolicyMap(ordered);
  const attribution = [...policyMap.byTable.values()];

  const violations = { atRisk: [], dynamicTarget: [] };
  const detail = new Map();
  const admitted = new Map();
  const reasons = {};
  for (const { file, sql } of ordered) {
    const tag = file.replace(/\.sql$/, '');
    const a = analyzeFile(sql, tenantScoped, policyMap);
    if (a.admitted.length > 0) admitted.set(tag, [...new Set(a.admitted.map(describeAdmission))].sort());
    if (a.blind.length > 0) {
      const listed = [...new Set(a.blind.map((w) => `${w.kind}:${w.table}`))].sort().join(' ');
      violations.atRisk.push(`atRisk:${tag}|${listed}`);
      detail.set(tag, a.blind.map(describeReason));
      for (const w of a.blind) reasons[w.why] = (reasons[w.why] ?? 0) + 1;
    } else if (a.dynamicBlind) {
      violations.dynamicTarget.push(`dynamicTarget:${tag}`);
    }
  }

  for (const k of Object.keys(violations)) violations[k] = [...new Set(violations[k])].sort();
  return {
    counts: {
      files: ordered.length,
      tenantScoped: tenantScoped.size,
      byPolicy: byPolicy.size,
      byColumn: byColumn.size,
      journalEntries,
      unlisted,
      policyTables: policyMap.byTable.size,
      policiesAttributed: attribution.reduce((n, p) => n + p.size, 0),
      ambientLoops: policyMap.ambient.length,
      reasons,
    },
    violations,
    detail,
    admitted,
  };
}

const KINDS = ['atRisk', 'dynamicTarget'];

// `--migrations-dir` / `--baseline` exist so the CLI contract — exit 0 clean,
// exit 1 on a new offender, exit 0 once mitigated — is testable against
// fixtures instead of only against the 120 real files. `--explain <tag|all>`
// names the policy that excuses each resolved write, because exit 0 covers both
// "the rows are visible" and "a policy reads nothing".
function resolvePaths(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  return {
    migrationsDir: flag('--migrations-dir') ?? DEFAULT_MIGRATIONS_DIR,
    baselinePath: flag('--baseline') ?? DEFAULT_BASELINE_PATH,
    // Baseline keys drop the extension while every other mention of a migration
    // in this repo keeps it, so accept both — a `.sql` argument that resolved to
    // nothing would read as "this file excuses no write" when it excuses two.
    explain: flag('--explain')?.replace(/\.sql$/, ''),
  };
}

function main() {
  const { migrationsDir, baselinePath, explain } = resolvePaths(process.argv);
  const { counts, violations, detail, admitted } = collect(migrationsDir);
  const flat = KINDS.flatMap((k) => violations[k]);

  if (explain) {
    const tags = explain === 'all' ? [...admitted.keys()] : [explain];
    for (const tag of tags) {
      const lines = admitted.get(tag);
      console.log(`[explain] ${tag}: ${lines ? `${lines.length} resolved write(s)` : 'no resolved tenant write'}`);
      for (const line of lines ?? []) console.log(`       - ${line}`);
    }
  }

  if (process.argv.includes('--update')) {
    const body = {
      _comment: 'Migrations that write rows into a tenant-scoped table whose RLS policies no GUC they set can satisfy (PP-058, per-table rule from #2516). scripts/migrate.ts runs on a bare pool with no app.current_tenant and FORCE RLS removes the owner bypass, so those writes match ZERO rows: the repair is a silent no-op while CREATE UNIQUE INDEX / SET NOT NULL still see the real data, and the deploy aborts. Resolved per table against the policies the chain leaves on it: app.current_tenant always counts, app.is_super_admin counts only where a policy of THAT table reads it (webhook_events/0109 yes; custom_entities, custom_entity_data, segment_members no). CI cannot catch this — apply-rls-ci.mjs runs the same files as the postgres superuser, which RLS does not filter. Shrink this baseline as files are fixed; the guard fails on any NEW offender. Regenerate: node scripts/check-migration-rls-dml.mjs --update',
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
    `  policies read per table: ${counts.policiesAttributed} on ${counts.policyTables} table(s) from ${counts.journalEntries} journal entries (${counts.unlisted} file(s) not in the journal), ${counts.ambientLoops} catalogue loop(s) left unattributed`,
    `  baselined: ${(baseline.violations?.atRisk ?? []).length} row-write offender(s), ${(baseline.violations?.dynamicTarget ?? []).length} dynamic-target file(s)`,
  ].join('\n'));

  if (healed.length > 0) {
    console.log(`  ..   ${healed.length} baselined offender(s) are gone — shrink the baseline:`);
    for (const v of healed) console.log(`       - ${v}`);
    console.log('       node scripts/check-migration-rls-dml.mjs --update');
  }

  if (fresh.length > 0) {
    console.error(`  ${fresh.length} NEW RLS-blind write(s):`);
    for (const v of fresh) {
      console.error(`   x ${v}`);
      const tag = v.split('|')[0].replace(/^atRisk:/, '').replace(/^dynamicTarget:/, '');
      for (const line of detail.get(tag) ?? []) console.error(`       ${line}`);
    }
    console.error([
      '',
      'scripts/migrate.ts runs on a bare pool with no app.current_tenant, and every',
      'tenant table is FORCE ROW LEVEL SECURITY — so the owner does not bypass RLS',
      'here and these statements match zero rows (PP-058). The repair is then a',
      'silent no-op while CREATE UNIQUE INDEX / SET NOT NULL still see the real',
      'data, and the run aborts mid-deploy. CI will not catch it either:',
      'apply-rls-ci.mjs applies these files as the postgres superuser.',
      '',
      'Set a GUC the policies of the table you write actually read, transaction-',
      'locally, in the same DO block as the write:',
      '',
      "    PERFORM set_config('app.current_tenant', <tenant_id>::text, true);",
      '',
      'Loop it over the tenants you are repairing, which is what',
      '0125_declared_not_null_columns.sql does. app.is_super_admin is a second',
      'option only where a policy of that table ORs on it (0093 webhook_events,',
      '0100 tenants, 0115 error_logs) — see 0109_webhook_events_created_at_not_null',
      '.sql for that shape. Naming either one in a comment proves nothing.',
      '',
      'Do NOT add an entry to the baseline without a reason in the PR that does so.',
    ].join('\n'));
    process.exit(1);
  }

  console.log('[check-migration-rls-dml] OK — no new RLS-blind writes.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
