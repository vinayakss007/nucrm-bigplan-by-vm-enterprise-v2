/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Tenant-DB choke-point screen (#3405).
 *
 * #3405's finding is that RLS context is an ambient side effect written onto a
 * pooled connection while the DB client is a globally importable singleton, so
 * nothing joins "this statement runs" to "a tenant GUC is set on this
 * connection". The durable fix (PR-3A) is `withTenantDb`/`withSystemDb` with a
 * branded client, which deletes the raw import from 522 files. That refactor is
 * the largest in `docs/reports/FIX-PLAN-2026-11-01.md` and cannot land in one
 * reviewable commit — so this screen holds the line in the meantime:
 *
 *   A file outside `lib/db/` may import the raw client only if
 *   `scripts/tenant-db-ledger.json` lists it under a directory entry that names
 *   a reason and a filed issue.
 *
 * The ledger is an exact set, not a ceiling: every listed file must STILL import
 * the raw client, or the run fails and the entry has to be deleted. That is what
 * makes it ratchet down — migrate a file to the choke point and the stale entry
 * goes red until it is removed, so the number can only fall. A new file, a new
 * directory or a copy-paste of an existing route lands outside the set and fails
 * the build, which is the one property a count-only baseline cannot give: a new
 * offender cannot hide behind another file's removal.
 *
 * Why per-file and not per-line: a line number rots the first time someone
 * formats a route, and "may this module hold the pool?" is a property of the
 * file. Why `lib/db/` is exempt: that directory *is* the choke point — it owns
 * the pool, the `SET LOCAL` helpers and the 15 GUC names #3405 counted, so
 * importing the client there is the whole point.
 *
 * What this screen does NOT do, stated so the ledger is not read as a fix: it
 * sees an import, not a statement, so it cannot tell whether an allowlisted file
 * binds `app.current_tenant` before it queries. A route that already imports the
 * client and adds a second unbound read is invisible here — that is PR-3A's job,
 * and every entry below names the issue that carries it.
 *
 * Usage:
 *   node scripts/check-tenant-db-context.mjs                 # scan, exit 1 on findings
 *   node scripts/check-tenant-db-context.mjs --json          # machine-readable report
 *   node scripts/check-tenant-db-context.mjs --roots=a,b     # scan different prefixes
 *   node scripts/check-tenant-db-context.mjs --update        # rewrite the ledger
 *
 * `--update` adds new groups with a `TODO:` reason, so an unreviewed
 * exemption is a red build with the reason sitting in the diff rather than a
 * silent pass.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER_FILE = 'scripts/tenant-db-ledger.json';

/** Tree that serves tenant input. `scripts/**` is operator CLI, same call as #3292. */
export const DEFAULT_ROOTS = ['app', 'lib', 'worker.ts'];

/** The choke point's own home: the pool, the GUC helpers, the branded client. */
export const CHOKE_POINT_PREFIXES = ['lib/db/'];

/** A ledger reason below this length is a label, not an argument. */
export const MIN_REASON_LENGTH = 40;

const SKIP_RE = /(^|\/)(node_modules|\.next|coverage|dist)\//;
const TEST_RE = /(\.test\.|\.spec\.)/;

/** The import forms that reach the raw client — alias and relative spellings. */
const FROM_RAW_CLIENT_RE =
  /\b(import|export)\s+(type\s+)?[\w\s{},*$]*?from\s*['"](?:@\/drizzle\/db|(?:\.\.?\/)+drizzle\/db)['"]/g;
/** Side-effect form: `import '@/drizzle/db'`. */
const BARE_RAW_CLIENT_RE = /\bimport\s*['"](?:@\/drizzle\/db|(?:\.\.?\/)+drizzle\/db)['"]/;

const ISSUE_REF_RE = /^#\d+$/;

function isSkipped(path) {
  return SKIP_RE.test(path) || TEST_RE.test(path);
}

function walk(abs, out) {
  for (const name of readdirSync(abs)) {
    const p = join(abs, name);
    if (isSkipped(p)) continue;
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Does this source import the raw client as a VALUE?
 *
 * `import type { … } from '@/drizzle/db'` is not a leak: a type import is erased
 * before the module runs, so it cannot open a connection. Everything else — a
 * default import, a named import, a namespace import, a re-export, the
 * side-effect form — can.
 */
export function importsRawClient(src) {
  const matches = [];
  FROM_RAW_CLIENT_RE.lastIndex = 0;
  for (const m of src.matchAll(FROM_RAW_CLIENT_RE)) {
    if (m[2]) continue; // `import type …`
    matches.push(m[0].replace(/\s+/g, ' ').trim());
  }
  if (BARE_RAW_CLIENT_RE.test(src)) matches.push("import '@/drizzle/db'");
  return matches;
}

/** Every file under `roots` that imports the raw client outside the choke point. */
export function scanRepo({ root = REPO_ROOT, roots = DEFAULT_ROOTS } = {}) {
  const offenders = [];
  for (const prefix of roots) {
    const abs = join(root, prefix);
    if (!existsSync(abs)) continue;
    const files = statSync(abs).isDirectory() ? walk(abs, []) : [abs];
    for (const file of files) {
      const rel = relative(root, file).split('\\').join('/');
      if (isSkipped(rel)) continue;
      if (CHOKE_POINT_PREFIXES.some((p) => rel.startsWith(p))) continue;
      const src = readFileSync(file, 'utf8');
      const imports = importsRawClient(src);
      if (imports.length > 0) offenders.push({ file: rel, imports });
    }
  }
  return offenders.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Ledger group for a path: the first two segments, so one argued entry covers an
 * area instead of one per route directory. `lib/ai/tools/x.ts` -> `lib/ai`,
 * `app/api/tenant/deals/route.ts` -> `app/api/tenant`, `app/setup/page.tsx` -> `app`.
 * The reason is per group; the file set inside it stays exact.
 */
export function groupOf(file) {
  const parts = file.split('/');
  // Route handlers get their own entry per API area: 389 files under one
  // "app/api" reason would be a label, not an argument.
  if (parts[0] === 'app' && parts[1] === 'api' && parts.length > 3) return parts.slice(0, 3).join('/');
  if (parts.length <= 2) return parts[0] === 'app' || parts[0] === 'lib' ? parts[0] : file;
  return parts.slice(0, 2).join('/');
}

/**
 * Compare the scanned tree against the ledger. Pure: no fs, no process.
 *
 * Findings are `{ code, message }` where code is one of
 *   unlisted-file      a file imports the raw client and no entry admits it
 *   stale-entry        an entry names a file that no longer imports it (or is gone)
 *   missing-reason     an entry's reason is absent or shorter than MIN_REASON_LENGTH
 *   unreviewed-reason  an entry still carries the `--update` placeholder
 *   missing-filed-as   an entry's `filedAs` is not an issue reference
 */
export function evaluateLedger(offenders, ledger) {
  const findings = [];
  const groups = ledger?.groups ?? {};

  for (const [dir, entry] of Object.entries(groups)) {
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
    if (reason.length < MIN_REASON_LENGTH) {
      findings.push({
        code: 'missing-reason',
        message: `${dir}: reason is ${reason.length} chars — say why this directory may still hold the raw client (>= ${MIN_REASON_LENGTH})`,
      });
    }
    if (/^todo\b/i.test(reason)) {
      findings.push({
        code: 'unreviewed-reason',
        message: `${dir}: reason is still the --update placeholder — write the argument, or migrate the files and delete the entry`,
      });
    }
    if (!ISSUE_REF_RE.test(String(entry?.filedAs ?? ''))) {
      findings.push({
        code: 'missing-filed-as',
        message: `${dir}: filedAs must be an issue reference like "#3405" — got ${JSON.stringify(entry?.filedAs ?? null)}`,
      });
    }
    if (!Array.isArray(entry?.files)) {
      findings.push({ code: 'missing-filed-as', message: `${dir}: files must be an array of paths` });
    }
  }

  const listed = new Map();
  for (const [dir, entry] of Object.entries(groups)) {
    for (const file of entry?.files ?? []) listed.set(file, dir);
  }

  for (const offender of offenders) {
    if (!listed.has(offender.file)) {
      findings.push({
        code: 'unlisted-file',
        message:
          `${offender.file}: imports the raw client (${offender.imports[0]}) and the ledger does not admit it. ` +
          `Bind it through lib/db's tenant context helpers, or add an entry under "${groupOf(offender.file)}" ` +
          'with a reason and a filed issue — a new unbound read returns zero rows silently (#3405).',
      });
    }
  }

  const current = new Set(offenders.map((o) => o.file));
  for (const [file, dir] of listed) {
    if (!current.has(file)) {
      findings.push({
        code: 'stale-entry',
        message:
          `${file}: listed under "${dir}" but no longer imports the raw client (or no longer exists). ` +
          'Delete the entry — the ledger is an exact set so it can only ratchet down.',
      });
    }
  }

  return { ok: findings.length === 0, findings, listedFiles: listed.size, scannedOffenders: offenders.length };
}

/** Build a ledger from a scan, keeping reasons already written by hand. */
export function buildLedger(offenders, previous = {}) {
  const previousGroups = previous?.groups ?? {};
  const groups = {};
  for (const offender of offenders) {
    const dir = groupOf(offender.file);
    groups[dir] ??= {
      reason: previousGroups[dir]?.reason ?? 'TODO: this area is not yet bound to a tenant context (#3405 PR-3A).',
      filedAs: previousGroups[dir]?.filedAs ?? '#3405',
      files: [],
    };
    groups[dir].files.push(offender.file);
  }
  const sorted = {};
  for (const dir of Object.keys(groups).sort()) {
    sorted[dir] = { ...groups[dir], files: [...groups[dir].files].sort() };
  }
  return {
    _comment:
      'Exact-set ledger for scripts/check-tenant-db-context.mjs (#3405). Every file here imports the raw DB client ' +
      'outside lib/db, the choke point that owns the pool and the tenant GUCs. The list may only shrink: migrate a file ' +
      'through lib/db and delete its entry, or the guard fails on the stale entry. Do not add a file to make CI green — ' +
      'a statement that runs on the pool without app.current_tenant returns zero rows silently, which is the failure ' +
      '#3405 was filed for. Regenerate with `node scripts/check-tenant-db-context.mjs --update`.',
    issue: 3405,
    roots: DEFAULT_ROOTS,
    chokePoint: CHOKE_POINT_PREFIXES,
    groups: sorted,
  };
}

export function readLedger({ root = REPO_ROOT, ledgerFile = LEDGER_FILE } = {}) {
  const path = resolve(root, ledgerFile);
  if (!existsSync(path)) return { groups: {} };
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Whole check: scan the tree and evaluate it against the ledger. */
export function check({ root = REPO_ROOT, roots = DEFAULT_ROOTS, ledger } = {}) {
  const resolved = ledger ?? readLedger({ root });
  const offenders = scanRepo({ root, roots });
  return { offenders, ...evaluateLedger(offenders, resolved) };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name) => {
    const hit = argv.find((a) => a.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : undefined;
  };

  if (flag('--help') || flag('-h')) {
    console.log(
      'Usage: node scripts/check-tenant-db-context.mjs [--json] [--update] [--roots=a,b] [--ledger=path] [--root=dir]',
    );
    return 0;
  }

  // The CLI reads the tree it is invoked in, like every other guard here, so a
  // fixture directory can be checked without touching this repository. The
  // library functions default to REPO_ROOT for the tests that assert on it.
  const root = value('--root') ?? process.cwd();
  const roots = value('--roots') ? value('--roots').split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ROOTS;
  const ledgerFile = value('--ledger') ?? LEDGER_FILE;
  const offenders = scanRepo({ root, roots });

  if (flag('--update')) {
    const previous = readLedger({ root, ledgerFile });
    const ledger = buildLedger(offenders, previous);
    writeFileSync(resolve(root, ledgerFile), `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(
      `[tenant-db-context] wrote ${ledgerFile}: ${offenders.length} file(s) in ${Object.keys(ledger.groups).length} groups`,
    );
  }

  const ledger = readLedger({ root, ledgerFile });
  const result = evaluateLedger(offenders, ledger);

  if (flag('--json')) {
    console.log(JSON.stringify({ ...result, offenders, ledger: ledgerFile }, null, 2));
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    console.log(
      `[tenant-db-context] OK — ${result.scannedOffenders} file(s) import the raw client outside ${CHOKE_POINT_PREFIXES.join(', ')}; ` +
        `every one is admitted by ${ledgerFile} with a reason. Nothing new may join the list (#3405).`,
    );
    return 0;
  }

  console.error(`[tenant-db-context] ✖ ${result.findings.length} finding(s) (#3405):`);
  for (const finding of result.findings) console.error(`  - [${finding.code}] ${finding.message}`);
  console.error(
    '\n  The tenant GUC is ambient state on a pooled connection: a query that runs before ' +
      'app.current_tenant is set returns zero rows instead of failing. Bind new code through ' +
      'lib/db, or add an argued ledger entry under the directory that owns it.',
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
