/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Public-route soft-delete guard (#2382).
 *
 * Two defects of the same class reached `main` before anyone noticed: #2378
 * (every customer-facing portal ticket read ignored `support_tickets.deleted_at`)
 * and #2380 (a deleted `documents` row left its public signing link live and
 * signable). Both were found by hand-auditing route files. The class is
 * statically detectable, so the next one should cost a CI failure.
 *
 * Rule: a read of a soft-deletable table on an UNAUTHENTICATED route
 * (`app/api/public/**`) must test that table's `deleted_at` for NULL — in the
 * same statement, or in the exported gate the route delegates to.
 *
 * Soft-deletable is derived from drizzle itself (`getTableColumns`), never from
 * a hand-maintained list, because the column normally arrives through the
 * `utils.lifecycle()` SPREAD — it is invisible to a grep for `deletedAt:`. That
 * is how #2385 and #2393 stayed invisible for so long.
 *
 * Exemptions live in `scripts/portal-softdelete-baseline.json` and are
 * RE-VERIFIED on every run, not trusted:
 *   - `{ gate, via }` — the route must still CALL `gate`, `via` must still
 *     EXPORT it, and that function must still filter the table. A route that
 *     stops calling its gate, or a gate that loses its predicate, fails here
 *     instead of quietly reopening the hole.
 *   - `{ reason, pinnedBy }` with no gate — for a read that is deliberately
 *     unfiltered (the token→identity lookup in app/api/public/tickets/route.ts:
 *     filtering it would lock a customer out of their whole ticket history
 *     because one ticket was deleted). `reason` must be long enough for a
 *     reviewer to disagree with, and `pinnedBy` must name a test file that
 *     exists.
 * An exemption that matches nothing is reported so the list ratchets down, like
 * the other baselines in this directory.
 *
 * Usage: npm run guard:portal-softdelete [--json] [dir…]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTableColumns, getTableName } from 'drizzle-orm';

// ── the soft-deletable set, derived ──────────────────────────────────────────

export type SoftTable = { js: string; sql: string };

export const MIN_SOFT_DELETABLE_TABLES = 100;

/**
 * `drizzle/schema/index.ts` opens with 41 `export *` lines, but its namespace
 * under tsx has 3 keys while `./core` alone has 21 — the star re-exports do not
 * survive the CJS interop. Reading the schema through the index therefore
 * derives 2 soft-deletable tables instead of ~200, and a guard that quietly
 * derives almost nothing prints "OK" for every route. Load each module by path.
 */
export async function loadSchemaModules(root = '.'): Promise<Record<string, unknown>> {
  const dir = join(root, 'drizzle', 'schema');
  if (!existsSync(dir)) throw new Error(`${dir} is missing — cannot derive the soft-deletable set`);
  const merged: Record<string, unknown> = {};
  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts' && !f.startsWith('_'),
  );
  for (const name of files) {
    const mod = await import(pathToFileURL(join(dir, name)).href) as Record<string, unknown>;
    for (const [key, value] of Object.entries(mod)) {
      if (key !== 'default') merged[key] = value;
    }
  }
  return merged;
}

/** export name → physical table name, for every table carrying deleted_at. */
export function softDeletableTables(
  mod: Record<string, unknown>,
): Map<string, SoftTable> {
  const out = new Map<string, SoftTable>();
  for (const [js, value] of Object.entries(mod)) {
    if (!value || typeof value !== 'object') continue;
    let columns: Record<string, { name: string }>;
    try {
      columns = getTableColumns(value as never);
    } catch {
      continue; // relations, enums, helpers — not a table
    }
    // getTableColumns answers undefined (not a throw) for some schema exports,
    // and a derived set that quietly shrinks is the failure mode this whole
    // guard is aimed at.
    if (!columns) continue;
    if (!Object.values(columns).some((c) => c?.name === 'deleted_at')) continue;
    out.set(js, { js, sql: getTableName(value as never) });
  }
  return out;
}

// ── statement splitting (string-, template- and comment-aware) ───────────────

export type Span = { start: number; end: number; text: string };

/**
 * Split source at every `;` outside any string, template literal or comment —
 * including `;` inside a block. Splitting only at depth 0 would make an entire
 * `if (token) { … }` one statement, and the `isNull(supportTickets.deletedAt)`
 * four lines *below* the unfiltered token lookup would credit that lookup: the
 * #2378 hole would have scanned clean. Per-query granularity is what lets the
 * baseline say "this query is deliberately unfiltered" instead of "this file".
 * The template case is the other one that matters: a raw `db.execute(sql`…`)`
 * read IS the statement, and its `${}` interpolations can contain further
 * braces, quotes and semicolons.
 */
export function splitStatements(source: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  let i = 0;
  const n = source.length;

  const push = (from: number, to: number) => {
    const text = source.slice(from, to);
    if (text.trim().length > 0) spans.push({ start: from, end: to, text });
  };

  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '`') { i++; break; }
        if (source[i] === '$' && source[i + 1] === '{') {
          i += 2;
          let inner = 1;
          while (i < n && inner > 0) {
            if (source[i] === '{') inner++;
            else if (source[i] === '}') inner--;
            else if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
              const q = source[i];
              i++;
              while (i < n && source[i] !== q) { if (source[i] === '\\') i++; i++; }
            }
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === ';') { push(start, i); start = i + 1; }
    i++;
  }
  push(start, n);
  return spans;
}

export function spanAt(spans: Span[], offset: number): Span | undefined {
  return spans.find((s) => offset >= s.start && offset < s.end);
}

// ── finding the reads ────────────────────────────────────────────────────────

export type Read = {
  js: string;
  sql: string;
  line: number;
  kind: 'query' | 'from' | 'raw';
  statement: string;
};

const READ_PATTERNS: Array<{ re: RegExp; kind: Read['kind'] }> = [
  { re: /\bdb\.query\.([A-Za-z0-9_]+)\b/g, kind: 'query' },
  { re: /\.from\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g, kind: 'from' },

  { re: /\bFROM\s+([a-z][a-z0-9_]*)\b/gi, kind: 'raw' },
  { re: /\bJOIN\s+([a-z][a-z0-9_]*)\b/gi, kind: 'raw' },
];

/** Every read of a soft-deletable table, in source order, one per statement. */
export function findReads(source: string, soft: Map<string, SoftTable>): Read[] {
  const spans = splitStatements(source);
  const bySqlName = new Map<string, SoftTable>();
  for (const t of soft.values()) bySqlName.set(t.sql, t);
  const found: Array<Read & { offset: number; statementStart: number }> = [];

  for (const { re, kind } of READ_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const table = kind === 'raw' ? bySqlName.get(m[1]) : soft.get(m[1]);
      if (!table) continue;
      const statement = spanAt(spans, m.index);
      if (!statement) continue;
      // A `FROM` inside a comment, a zod enum or a help string is not a read;
      // require the statement to actually reach the database.
      if (kind === 'raw' && !/\bdb\.(execute|transaction)\b/.test(statement.text)) continue;
      found.push({
        js: table.js,
        sql: table.sql,
        line: source.slice(0, m.index).split('\n').length,
        kind,
        statement: statement.text,
        offset: m.index,
        statementStart: statement.start,
      });
    }
  }

  // One finding per (statement, table): naming `documents` twice in one SELECT
  // is one gate to satisfy, and duplicate reports help nobody.
  const seen = new Set<string>();
  const out: Read[] = [];
  for (const r of found.sort((a, b) => a.offset - b.offset)) {
    const key = `${r.statementStart}:${r.js}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ js: r.js, sql: r.sql, line: r.line, kind: r.kind, statement: r.statement });
  }
  return out;
}

// ── does the statement test the tombstone? ───────────────────────────────────

/**
 * The tombstone column must be TESTED, not merely mentioned: a
 * `select({ deletedAt: documents.deletedAt })` projection says nothing about
 * which rows come back. So match the shapes that actually filter —
 * `isNull(x.deletedAt)`, `eq(x.deletedAt, null)`, `` sql`${x.deletedAt} IS NULL` ``,
 * or `x.deleted_at IS NULL` in raw SQL.
 *
 * When the statement reads exactly one soft-deletable table, an unqualified
 * `deleted_at IS NULL` credits it. That is deliberately the permissive
 * direction: this guard exists to catch *no filter at all*, which is how both
 * #2378 and #2380 shipped.
 */
export function isFiltered(read: Read, tablesInStatement: string[]): boolean {
  const text = read.statement;
  const tested = (prefix: string, column: string) =>
    new RegExp(`isNull\\(\\s*${prefix}\\.${column}\\b`).test(text)
    || new RegExp(`eq\\(\\s*${prefix}\\.${column}\\b[^)]*,\\s*null`).test(text)
    || new RegExp(`${prefix}\\.${column}\\}?\\s+IS\\s+NULL`, 'i').test(text);

  if (tested(read.js, 'deletedAt') || tested(read.sql, 'deleted_at')) return true;
  if (tablesInStatement.length <= 1) {
    return /\bdeleted_at\s+IS\s+NULL\b/i.test(text) || /\bisNull\([^)]*deletedAt\b/.test(text);
  }
  return false;
}

/** Soft-deletable tables named anywhere in a text — the ambiguity denominator. */
export function tablesIn(text: string, soft: Map<string, SoftTable>): string[] {
  const found = new Set<string>();
  for (const t of soft.values()) {
    if (new RegExp(`\\b${t.js}\\.`).test(text) || new RegExp(`\\b${t.sql}\\b`, 'i').test(text)) {
      found.add(t.js);
    }
  }
  return [...found];
}

// ── the baseline ─────────────────────────────────────────────────────────────

export type BaselineEntry = {
  file: string;
  table: string;
  gate?: string;
  via?: string;
  reason?: string;
  pinnedBy?: string;
};

export function loadBaseline(path = 'scripts/portal-softdelete-baseline.json'): BaselineEntry[] {
  if (!existsSync(path)) {
    throw new Error(`missing ${path} — the guard cannot verify exemptions it cannot read`);
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { entries?: BaselineEntry[] };
  return parsed.entries ?? [];
}

function matches(entry: BaselineEntry, file: string, read: Read): boolean {
  // Deliberately no "*" wildcard: a file-level exemption is exactly the
  // anything-goes entry this guard was written to avoid.
  if (entry.file !== file) return false;
  return entry.table === read.js || entry.table === read.sql;
}

/**
 * Re-verify an exemption instead of trusting it. Returns why it no longer
 * holds, or null when it is still honest.
 */
export function verifyEntry(entry: BaselineEntry, root = '.'): string | null {
  if (entry.gate) {
    if (!entry.via) return `gate "${entry.gate}" needs the file it lives in (via)`;
    if (!(entry.reason ?? '').trim()) return `gate exemption for ${entry.file} needs a reason too`;
    const viaPath = join(root, entry.via);
    if (!existsSync(viaPath)) return `${entry.via} does not exist`;
    const viaSrc = readFileSync(viaPath, 'utf8');
    if (!gateExportedRegex(entry.gate).test(viaSrc)) {
      return `${entry.via} no longer exports ${entry.gate}()`;
    }
    if (!existsSync(join(root, entry.file))) return `${entry.file} does not exist`;
    const ownSrc = readFileSync(join(root, entry.file), 'utf8');
    if (!new RegExp(`\\b${entry.gate}\\s*\\(`).test(ownSrc)) {
      return `${entry.file} no longer calls ${entry.gate}() — the exemption is stale`;
    }
    return null;
  }
  const reason = (entry.reason ?? '').trim();
  if (reason.length < 40) {
    return 'a gate-less exemption needs a reason of at least 40 characters — one a reviewer can disagree with';
  }
  if (!entry.pinnedBy) return 'a gate-less exemption must name the test that pins it (pinnedBy)';
  if (!existsSync(join(root, entry.pinnedBy))) return `pinnedBy names ${entry.pinnedBy}, which does not exist`;
  return null;
}

function gateExportedRegex(gate: string): RegExp {
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${gate}\\b`);
}

/** Does the gate function itself test the table's tombstone? */
export function gateFiltersTable(
  entry: BaselineEntry,
  soft: Map<string, SoftTable>,
  root = '.',
): boolean {
  if (!entry.via || !entry.gate) return true;
  const table = soft.get(entry.table)
    ?? [...soft.values()].find((t) => t.sql === entry.table || t.js === entry.table);
  if (!table) return false;
  const src = readFileSync(join(root, entry.via), 'utf8');
  const start = src.search(gateExportedRegex(entry.gate));
  if (start < 0) return false;
  // The gate's body runs to the next top-level `export` — as close to
  // "that function" as a statement splitter gets without a real parser.
  const rest = src.slice(start + 1);
  const nextExport = rest.search(/\nexport\s/);
  const body = nextExport < 0 ? src.slice(start) : src.slice(start, start + 1 + nextExport);
  const inBody = tablesIn(body, soft);
  for (const span of splitStatements(body)) {
    if (!new RegExp(`\\b${table.js}\\b|\\b${table.sql}\\b`).test(span.text)) continue;
    if (isFiltered(
      { js: table.js, sql: table.sql, line: 0, kind: 'from', statement: span.text },
      inBody,
    )) return true;
  }
  return false;
}

// ── the walk ─────────────────────────────────────────────────────────────────

export type Violation = {
  file: string;
  table: string;
  line: number;
  kind: Read['kind'];
  problem: string;
};

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

export function analyzeFile(
  file: string,
  source: string,
  soft: Map<string, SoftTable>,
  baseline: BaselineEntry[],
  root = '.',
): { violations: Violation[]; used: Set<BaselineEntry> } {
  const rel = relative(root, file) || file;
  const violations: Violation[] = [];
  const used = new Set<BaselineEntry>();

  for (const read of findReads(source, soft)) {
    if (isFiltered(read, tablesIn(read.statement, soft))) continue;
    const entry = baseline.find((e) => matches(e, rel, read));
    if (!entry) {
      violations.push({
        file: rel, table: read.js, line: read.line, kind: read.kind,
        problem: 'unfiltered read of a soft-deletable table on an unauthenticated route',
      });
      continue;
    }
    const stale = verifyEntry(entry, root);
    if (stale) {
      violations.push({ file: rel, table: read.js, line: read.line, kind: read.kind, problem: stale });
      continue;
    }
    if (entry.gate && !gateFiltersTable(entry, soft, root)) {
      violations.push({
        file: rel, table: read.js, line: read.line, kind: read.kind,
        problem: `gate ${entry.gate}() in ${entry.via} no longer filters ${read.js}.deleted_at`,
      });
      continue;
    }
    used.add(entry);
  }
  return { violations, used };
}

/**
 * A derived set this small means the schema stopped loading, not that the
 * product deleted 100 tables. Fail loudly rather than bless every route.
 */
export function assertSchemaDerived(soft: Map<string, SoftTable>): void {
  if (soft.size < MIN_SOFT_DELETABLE_TABLES) {
    throw new Error(
      `derived only ${soft.size} soft-deletable table(s); expected at least ` +
      `${MIN_SOFT_DELETABLE_TABLES} — the schema did not load, so this run proves nothing`,
    );
  }
}

export type RunOptions = { soft?: Map<string, SoftTable>; baseline?: BaselineEntry[] };

export async function run(
  dirs: string[],
  root = '.',
  opts: RunOptions = {},
): Promise<{ violations: Violation[]; files: number; unused: BaselineEntry[]; softCount: number }> {
  let soft = opts.soft;
  if (!soft) {
    soft = softDeletableTables(await loadSchemaModules(root));
    assertSchemaDerived(soft);
  }
  const baseline = opts.baseline
    ?? loadBaseline(join(root, 'scripts/portal-softdelete-baseline.json'));
  const violations: Violation[] = [];
  const usedEntries = new Set<BaselineEntry>();
  let files = 0;

  for (const dir of dirs) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const file of routeFiles(abs)) {
      files++;
      const { violations: v, used } = analyzeFile(file, readFileSync(file, 'utf8'), soft, baseline, root);
      violations.push(...v);
      for (const u of used) usedEntries.add(u);
    }
  }
  const unused = baseline.filter((e) => !usedEntries.has(e)
    && !violations.some((v) => v.file === e.file && v.table === e.table));
  return { violations, files, unused, softCount: soft.size };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const dirs = argv.filter((a) => !a.startsWith('--'));
  const targets = dirs.length > 0 ? dirs : ['app/api/public'];
  const { violations, files, unused, softCount } = await run(targets);

  if (json) {
    console.log(JSON.stringify({ scanned: files, softDeletable: softCount, violations, unused }, null, 2));
    if (violations.length > 0) process.exit(1);
    return;
  }
  if (violations.length > 0) {
    const rows = violations.map((v) => `    ${v.file}:${v.line}  ${v.table} (${v.kind}) — ${v.problem}`);
    console.error(
      `\n\x1b[31m✖ Public soft-delete guard failed (#2382).\x1b[0m\n` +
      `\n  ${files} public route file(s) scanned against ${softCount} soft-deletable table(s).\n` +
      `  ${violations.length} read(s) carry no deleted_at predicate, on a route whose\n` +
      `  caller is anonymous by construction:\n\n` +
      rows.join('\n') +
      '\n\n  Fix: test the tombstone in the WHERE (isNull(<table>.deletedAt)), or route the\n' +
      '  read through a gate that does, or add an entry to\n' +
      '  scripts/portal-softdelete-baseline.json with the reason and the test that\n' +
      '  pins it — this guard re-verifies exemptions, it does not trust them.\n',
    );
    process.exit(1);
  }
  console.log(
    `[check-portal-soft-delete] OK — ${files} public route file(s) scanned against ` +
    `${softCount} soft-deletable tables; every read is filtered or has a verified exemption.`,
  );
  if (unused.length > 0) {
    console.warn(
      `\n\x1b[33m⚠ ${unused.length} baseline entr(y/ies) no longer match anything — remove them:\x1b[0m\n` +
      unused.map((e) => `    - ${e.file} ${e.table}`).join('\n') + '\n',
    );
  }
}

// Only when run directly: the unit suite imports these functions.
if (process.argv[1]?.includes('check-portal-soft-delete')) {
  main().catch((err) => {
    console.error(`[check-portal-soft-delete] ${(err as Error).message}`);
    process.exit(1);
  });
}
