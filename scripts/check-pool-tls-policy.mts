/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Pool TLS-policy guard (#3381).
 *
 * `pg` does not read `?sslmode=` from a connection string — that parameter is
 * libpq's, spoken by psql/pg_dump/pg_restore. A node-pg pool has exactly one
 * TLS channel: the `ssl` option. Omit it and the driver connects in plaintext
 * whatever the URL claims. `lib/db/ssl-config.ts` is the single policy; #3256
 * and #3381 fixed the call sites that had decided TLS for themselves. This
 * screen is what makes that the LAST manual pass: every `new Pool(` in
 * first-party source — `.ts`, `.mts`, `.mjs` — must carry a TLS entry in its
 * options, by one of these shapes:
 *
 *   - an `ssl:` property (any expression), or
 *   - the shorthand `ssl` naming a variable (`scripts/dr.ts`,
 *     `scripts/preflight.ts`, `scripts/bootstrap-test-db.ts`), or
 *   - a by-name options object (`new Pool(poolConfig)` at
 *     `lib/db/pool.ts:203`): #3381's open question, decided — a variable is
 *     covered ONLY when this screen can resolve it to an object literal in the
 *     same file and that literal satisfies the rules above. An unresolvable
 *     name is a finding, not a skip, because the grep-based alternative would
 *     report covered sites as missing and drive whoever fixes this to exempt
 *     the screen instead of the code. A refactor that hides the literal behind
 *     a function call must keep the literal reachable here or move its
 *     exemption into the baseline with a reason.
 *
 * Reporting is per FILE, not line (#guard:filesize / #guard:public-ratelimit
 * convention): inserting `ssl:` at one site must not fail the screen at
 * another, and a fix that adds a line cannot churn this screen's record.
 *
 * Exemptions live in `scripts/pool-tls-baseline.json`, are shrink-only, and
 * are RE-VERIFIED every run: an entry whose file no longer produces a finding
 * fails the screen, so an exemption cannot outlive its code. It is empty: the
 * one entry it was born with (`scripts/verify-backup.ts`, awaiting the PR for
 * #3256) went stale the moment that landed.
 *
 * Usage: npm run guard:pool-tls [--json] [root]   (root defaults to the repo; pass
 * a directory to scan a smaller tree, which is how the unit screen feeds fixtures)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_FILE = 'scripts/pool-tls-baseline.json';

/**
 * Floor measured on this tree the day #3381 landed (29 sites). If the walk
 * finds materially fewer pools than that, the walk is broken, not the code —
 * a guard that sees nothing passes everything.
 */
export const MIN_POOL_SITES = 25;

const SKIP_DIRS = new Set(['node_modules', '.next', '.qoder', 'tests', 'dist', 'coverage', '.git']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.startsWith('.') && SKIP_DIRS.has(name)) continue;
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...sourceFiles(p));
    } else if (
      (name.endsWith('.ts') || name.endsWith('.mts') || name.endsWith('.mjs'))
      && !name.endsWith('.d.ts')
    ) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Is the quoted run `[start, end)` an object key? It must open an entry — the
 * previous live character is `{` or `,` — and be addressed by a colon, so a
 * value in a ternary (`cond ? 'ssl' : 'no'`) stays data.
 */
function isKeyRun(src: string, start: number, end: number): boolean {
  const before = src.slice(0, start).replace(/\s+$/, '');
  if (!/[{,]$/.test(before)) return false;
  return /^:/.test(src.slice(end).replace(/^\s+/, ''));
}

/**
 * Blank `//` and `/* *​/` comments to spaces, offsets intact, and blank string
 * and template bodies too — this screen's only pattern is `new Pool(`, a
 * construct that belongs in code, never in data; a console message quoting it
 * (or this guard's own error strings) must not read as a pool site. A quoted
 * object KEY is the exception: it names an option, and `{ 'ssl': cfg }` is the
 * same connection as `{ ssl: cfg }`.
 */
export function maskComments(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  const n = src.length;
  const AFTER_OPERAND = /[A-Za-z0-9_$)\]]/;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    if (c === '/' && !AFTER_OPERAND.test(src.slice(0, i).replace(/\s+$/, '').slice(-1) ?? '')) {
      let j = i + 1;
      let cls = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '[') { cls = true; j++; continue; }
        if (e === ']' && cls) { cls = false; j++; continue; }
        if (e === '\n') break;
        if (e === '/' && !cls) { j++; break; }
        j++;
      }
      while (j < n && /[dgimsuy]/.test(src[j])) j++;
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        j++;
      }
      // `{ 'ssl': cfg }` names an option in quotes; blanking it would hide the
      // entry the pool carries. A run is only kept when it opens an object entry.
      if (!isKeyRun(src, i, j)) blank(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** End offset (exclusive) of the object literal whose `{` is at `open`. */
export function matchBraces(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Does this options literal carry a TLS entry? `ssl:` anywhere, or the
 * shorthand identifier `ssl` bounded by `{`/`,`/`}` — quoted either way, since
 * `{ 'ssl': cfg }` is the same connection as `{ ssl: cfg }`. A spread `...ssl` is NOT
 * credit: what it carries is a decision made somewhere else, and the point of
 * this screen is that the decision is visible at the pool.
 */
export function hasTlsEntry(objText: string): boolean {
  if (/(?<![A-Za-z0-9_$])['"]?ssl['"]?\s*:/.test(objText)) return true;
  return /[{,]\s*['"]?ssl['"]?\s*(?:[,}])/.test(objText);
}

export type PoolSite = {
  line: number;
  kind: 'literal' | 'variable' | 'unresolved';
  name?: string;
  hasTls: boolean;
  problem?: string;
};

const POOL_RE = /\bnew\s+(?:[A-Za-z_$][\w$]*\.)?Pool\s*\(\s*/g;

/** Every `new Pool(` site in one source, with its options resolved. */
export function poolSites(src: string): PoolSite[] {
  const masked = maskComments(src);
  const lineOf = (offset: number) => masked.slice(0, offset).split('\n').length;
  const sites: PoolSite[] = [];
  let m: RegExpExecArray | null;
  while ((m = POOL_RE.exec(masked)) !== null) {
    const at = m.index + m[0].length;
    const c = masked[at];
    if (c === '{') {
      const end = matchBraces(masked, at);
      if (end === -1) {
        sites.push({ line: lineOf(m.index), kind: 'unresolved', hasTls: false, problem: 'options literal never closes' });
        continue;
      }
      sites.push({ line: lineOf(m.index), kind: 'literal', hasTls: hasTlsEntry(masked.slice(at, end)) });
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(masked.slice(at))?.[0];
    if (!id) {
      sites.push({ line: lineOf(m.index), kind: 'unresolved', hasTls: false, problem: 'no options object or resolvable name after new Pool(' });
      continue;
    }
    // By-name decision, stated in the header: resolve to an in-file literal.
    const declRe = new RegExp(
      `(?:const|let|var)\\s+${id}(?:\\s*:\\s*[\\w.<>[\\]]+)?\\s*=\\s*\\{`,
    );
    const dm = declRe.exec(masked);
    if (!dm) {
      sites.push({
        line: lineOf(m.index), kind: 'unresolved', name: id, hasTls: false,
        problem: `PoolConfig \`${id}\` has no object-literal declaration in this file — a variable this screen cannot read is not coverage`,
      });
      continue;
    }
    const open = masked.indexOf('{', dm.index + dm[0].length - 1);
    const end = matchBraces(masked, open);
    if (end === -1) {
      sites.push({ line: lineOf(m.index), kind: 'unresolved', name: id, hasTls: false, problem: `declaration of \`${id}\` never closes` });
      continue;
    }
    sites.push({ line: lineOf(m.index), kind: 'variable', name: id, hasTls: hasTlsEntry(masked.slice(open, end)) });
  }
  return sites;
}

export type Finding = { file: string; count: number; problem: string; line: number };

/** One finding per (file, problem class); the report is by file, never by line. */
export function analyzeSource(rel: string, src: string): Finding[] {
  const sites = poolSites(src);
  const classes = new Map<string, { count: number; line: number }>();
  for (const s of sites) {
    if (s.hasTls) continue;
    const problem =
      s.kind === 'variable'
        ? `PoolConfig variable \`${s.name}\` resolves to a literal with no TLS entry`
        : s.problem ?? 'pool options carry no TLS entry — pg connects in plaintext whatever the URL says';
    const hit = classes.get(problem) ?? { count: 0, line: s.line };
    hit.count++;
    classes.set(problem, hit);
  }
  return [...classes].map(([problem, { count, line }]) => ({ file: rel, count, problem, line }));
}

export type BaselineEntry = { file: string; reason: string };

export function loadBaseline(root = ROOT): BaselineEntry[] {
  const path = join(root, BASELINE_FILE);
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, 'utf8')) as { entries?: BaselineEntry[] }).entries ?? [];
}

/** A baseline entry must have a real file with a real finding and a long reason. */
export function verifyEntry(entry: BaselineEntry, findings: Finding[], root = ROOT): string | null {
  if (!entry.file || entry.file.includes('..') || entry.file.startsWith('/')) {
    return `file must be a repository-relative path, not "${entry.file}"`;
  }
  if (!existsSync(join(root, entry.file))) return `${entry.file} does not exist — the exemption protects nothing`;
  if ((entry.reason ?? '').trim().length < 40) {
    return 'a deferral needs a reason of at least 40 characters — one a reviewer can disagree with';
  }
  if (!findings.some((f) => f.file === entry.file)) {
    return `${entry.file} produces no finding — the fix landed and this exemption outlived its code; delete the entry`;
  }
  return null;
}

export type RunResult = { findings: Finding[]; stale: Array<{ file: string; why: string }>; sites: number; files: number };

export function run(root = ROOT): RunResult {
  // The two floors below are about the repo walk, so they assert only when the
  // walk IS the repo. A caller scanning a smaller tree — the unit screen's
  // one-file fixtures — cannot satisfy them and must not be told to.
  const repoWide = resolve(root) === resolve(ROOT);
  const rel = (p: string) => relative(root, p).split(sep).join('/');
  const files = sourceFiles(root);
  if (repoWide && !files.some((f) => rel(f) === 'lib/db/ssl-config.ts')) {
    throw new Error('walk did not reach lib/db/ssl-config.ts — the tree is not mounted where this guard expects');
  }
  const findings: Finding[] = [];
  let sites = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!/\bnew\s+Pool\b|\bnew\s+(?:[A-Za-z_$][\w$]*\.)?Pool\s*\(/.test(src)) continue;
    const found = poolSites(src);
    sites += found.length;
    findings.push(...analyzeSource(rel(file), src));
  }
  if (repoWide && sites < MIN_POOL_SITES) {
    throw new Error(
      `found ${sites} Pool site(s); expected at least ${MIN_POOL_SITES} — the walk or the patterns broke, `
      + 'and a guard that sees nothing passes everything',
    );
  }
  const baseline = loadBaseline(root);
  const exempt = new Set(baseline.map((e) => e.file));
  const kept = findings.filter((f) => !exempt.has(f.file));
  const stale: Array<{ file: string; why: string }> = [];
  for (const entry of baseline) {
    const why = verifyEntry(entry, findings, root);
    if (why) stale.push({ file: entry.file, why });
  }
  return { findings: kept, stale, sites, files: files.length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const json = process.argv.includes('--json');
  const root = process.argv.slice(2).find((a) => !a.startsWith('-'));
  const { findings, stale, sites, files } = run(root ? resolve(root) : ROOT);
  if (json) {
    console.log(JSON.stringify({ scanned: files, sites, findings, stale }, null, 2));
  } else if (findings.length === 0 && stale.length === 0) {
    console.log(
      `[check-pool-tls-policy] OK — ${sites} Pool site(s) across ${files} file(s): every one passes `
      + 'the TLS policy (lib/db/ssl-config.ts), by-name configs resolved to a literal with ssl.',
    );
  }
  if (findings.length > 0 || stale.length > 0) {
    const rows = [
      ...findings.map((f) => `    ${f.file}  ${f.count} site(s) — ${f.problem}`),
      ...stale.map((s) => `    BASELINE ${s.file} — ${s.why}`),
    ];
    const msg =
      `\n  \x1b[31m✖ Pool TLS-policy guard failed (#3381).\x1b[0m\n\n${rows.join('\n')}\n\n`
      + '  Fix: add `ssl: pgSslConfig()` (import from lib/db/ssl-config) to the pool options —\n'
      + '  `?sslmode=` in the URL does NOTHING for node-pg; only the ssl option opens TLS.\n'
      + '  If the file is genuinely deferred (another PR is mid-fix), add an entry to\n'
      + `  ${BASELINE_FILE} naming a reason a reviewer can disagree with — the entry\n`
      + '  fails the screen the day its finding disappears, so it cannot outlive the code.\n';
    if (!json) console.error(msg);
    process.exit(1);
  }
}

// Only when run directly: the unit suite imports these functions.
if (process.argv[1]?.includes('check-pool-tls-policy')) main();
