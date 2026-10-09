/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Portal RLS-context guard (#2446).
 *
 * `0039` made every `tenant_isolation` policy fail CLOSED: with
 * `app.current_tenant` unset the predicate evaluates to NULL, so a read returns
 * zero rows and a write is refused. No policy error is raised for 194 of the
 * 198 policyed tables — the query simply answers "no rows", which is how an
 * entire customer portal went unreadable from `0015` to `0121` while every
 * suite stayed green: the tests mock `db`, and the one place that did not
 * (`contacts`, whose policy raises) had been pinned as an expected failure.
 *
 * Rule: inside the portal's request surface — `app/api/public/**` plus the
 * three portal-auth files — a table that carries a tenant policy may only be
 * reached through a handle that a context-establishing call bound
 * (`withTenantContext`, `withPortalLookupContext`, …). The bare pool `db` is
 * never such a handle, inside a callback or outside it: `lib/db/pool.ts` hands
 * out a different connection per query, so a `SET LOCAL` made three statements
 * ago is not on the connection this SELECT is about to run on.
 *
 * Which tables need a context is derived from drizzle (`drizzle/schema/*.ts`,
 * any table exposing a `tenant_id` column), never from a list someone has to
 * remember to update. Measured against `pg_policies` on a fully migrated
 * database: 194 of the 198 `tenant_isolation` tables have a `tenantId` in the
 * schema, and every one of those 194 is policyed — so the derived set denies
 * nothing that a policy would have allowed. The 4 it misses
 * (`contact_tags`, `lead_tags`, `email_warmup_logs`, `email_warmup_pool`) are
 * not reachable from any portal route; they are policyed by SQL migrations
 * without ever appearing in the schema, which is `guard:rls`' business, not
 * this guard's.
 *
 * Exemptions live in `scripts/portal-rls-context-baseline.json` and are
 * RE-VERIFIED every run: a reason long enough to argue with, the issue number
 * the work is deferred to, and a test file that exists and names the same
 * table. An entry that matches nothing is reported so the list ratchets down.
 * The five deferred files are the bearer-token surface (`offers/*`,
 * `sign/[token]`, `csat/[token]`) — they authenticate by unguessable token and
 * still read policyed tables on the pool, so they are broken in preprod too,
 * which contradicts this issue's premise that "only offers and CSAT work".
 * That surface is fixed as its own issue; it is not folded in here because
 * deriving a tenant from a token is a schema decision (the token tables need
 * the same narrow-lookup policy `0122` adds for `portal_clients`), not a
 * call-site one.
 *
 * Usage: npm run guard:portal-rls-context [--json] [file|dir…]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTableColumns, getTableName } from 'drizzle-orm';

// ── the policyed set, derived ────────────────────────────────────────────────

export type TenantTable = { js: string; sql: string };

/** A derived set this small means the schema stopped loading, not the product. */
export const MIN_TENANT_KEYED_TABLES = 100;
/** `find app/api/public -name route.ts` = 14, plus the three portal-auth files. */
export const MIN_SCANNED_FILES = 17;
/** If the walk finds no tenant-keyed read at all, the patterns stopped working. */
export const MIN_TABLE_READS = 20;

/**
 * Every call that binds a handle with RLS GUCs set: six from `lib/db/rls.ts`,
 * and `withPortalLookupContext` from `lib/db/portal-lookup-context.ts` (where
 * #2472 moved it to stay under the #1843 line ratchet). The guard matches on the
 * *call name* at each site, so the split changes nothing it can see — this list
 * is only where the names come from.
 */
export const CONTEXT_HELPERS = [
  'withTenantContext',
  'withSecurityContext',
  'withUserContext',
  'withAuthLookupContext',
  'withAuthResolutionContext',
  'withTrackingLookupContext',
  'withPortalLookupContext',
];

/**
 * A parameter declaration that says "this is a transaction handle", so a helper
 * that takes one and queries through it is as good as querying in the callback.
 */
export const HANDLE_TYPE = /\bRlsTransaction\b|\bParameters<Parameters<DbClient\['transaction'\]>/;

/**
 * `drizzle/schema/index.ts` re-exports with 41 `export *` lines that do not
 * survive the CJS interop under tsx, so the index derives 2 tables where the
 * files derive 194 (`check-portal-soft-delete.mts` records the same finding).
 * Load each file, and keep per-file exports: `activity.ts:activities` and
 * `infra.ts:activities` are the same table twice, and a merged map would drop
 * one of them silently — here, `documents` and `storage_documents` share an
 * export name across files, and merging loses `documents` altogether.
 */
/**
 * `drizzle/schema/index.ts` re-exports 42 files with `export *` and one with a
 * rename — `export { documents as storageDocuments } from './files'`, because
 * `files.ts` and `documents.ts` both export a `documents`. Loading the files
 * directly therefore sees one name for two tables, and the app does not: the
 * index is what a route's `import { documents }` resolves through. Read the
 * index's own re-export list and apply it, rather than inventing a table map
 * the routes do not have.
 */
export function schemaReExports(root = '.'): { star: Set<string>; explicit: Map<string, Map<string, string>> } {
  const src = maskComments(readFileSync(join(root, 'drizzle/schema/index.ts'), 'utf8'));
  const star = new Set<string>();
  const explicit = new Map<string, Map<string, string>>();
  for (const m of src.matchAll(/export\s*\*\s*from\s*'\.\/([\w-]+)'/g)) star.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+)'/g)) {
    const map = explicit.get(m[2]) ?? new Map<string, string>();
    for (const item of m[1].split(',')) {
      const parts = item.split(/\s+as\s+/);
      const local = parts[0]?.trim();
      if (local) map.set(local, (parts[1] ?? local).trim());
    }
    explicit.set(m[2], map);
  }
  return { star, explicit };
}

/**
 * The tenant-policyed tables in one module: anything exposing a `tenant_id`
 * column. Exported separately from `loadTenantTables` so a unit test can plant
 * a table without touching the repository's schema.
 */
export function tenantKeyedTables(
  mod: Record<string, unknown>,
  renames?: Map<string, string>,
): Map<string, TenantTable> {
  const out = new Map<string, TenantTable>();
  for (const [local, value] of Object.entries(mod)) {
    if (local === 'default' || !value || typeof value !== 'object') continue;
    // A file the index re-exports by an explicit list exposes nothing else.
    if (renames && !renames.has(local)) continue;
    const js = renames?.get(local) ?? local;
    let columns: Record<string, { name: string }> | undefined;
    try {
      columns = getTableColumns(value as never);
    } catch {
      continue; // relations, enums, helpers — not a table
    }
    if (!columns) continue;
    if (!Object.values(columns).some((c) => c?.name === 'tenant_id')) continue;
    let sql: string;
    try {
      sql = getTableName(value as never);
    } catch {
      continue;
    }
    out.set(js, { js, sql });
  }
  return out;
}

export async function loadTenantTables(root = '.'): Promise<Map<string, TenantTable>> {
  const dir = join(root, 'drizzle', 'schema');
  if (!existsSync(dir)) throw new Error(`${dir} is missing — cannot derive the policyed table set`);
  const { explicit } = schemaReExports(root);
  const byJs = new Map<string, TenantTable>();
  const conflicts: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.startsWith('_'))) {
    const mod = await import(pathToFileURL(join(dir, name)).href) as Record<string, unknown>;
    for (const [js, t] of tenantKeyedTables(mod, explicit.get(name.replace(/\.ts$/, '')))) {
      const prev = byJs.get(js);
      if (prev && prev.sql !== t.sql) conflicts.push(`${js} → ${prev.sql} AND ${t.sql}`);
      byJs.set(js, t);
    }
  }
  // Two exports of the same name pointing at DIFFERENT tables would make every
  // read of that name ambiguous; refusing to guess is refusing to under-report.
  if (conflicts.length > 0) throw new Error(`ambiguous table exports: ${conflicts.join('; ')}`);
  return byJs;
}

// ── comment masking + statement splitting ────────────────────────────────────

/**
 * Blank `//` and block comments to spaces, keeping every offset identical, so a
 * sentence like "a bare `db.select()` loses the context" in a route's own
 * comment is not counted as a read. Strings and template literals are left
 * alone — raw SQL lives in them and must stay visible to the patterns.
 */
export function maskComments(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  const n = src.length;
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
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

export type Span = { start: number; end: number; text: string };

/** Split at every `;` outside a string/template/comment (see #2382's guard). */
export function splitStatements(src: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  let i = 0;
  const n = src.length;
  const push = (from: number, to: number) => {
    const text = src.slice(from, to);
    if (text.trim().length > 0) spans.push({ start: from, end: to, text });
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`' && quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let inner = 1;
          while (i < n && inner > 0) {
            if (src[i] === '{') inner++;
            else if (src[i] === '}') inner--;
            else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
              const q = src[i];
              i++;
              while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
            }
            i++;
          }
          continue;
        }
        if (src[i] === quote) { i++; break; }
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

const lineOf = (src: string, offset: number) => src.slice(0, offset).split('\n').length;

// ── which identifiers are transaction handles ────────────────────────────────

/**
 * A handle is bound in exactly two ways: as the callback parameter of a
 * context-establishing call, or as a parameter declared to be an
 * `RlsTransaction` (the helper-that-queries shape). Everything else — `db`,
 * a `tx` from a bare `db.transaction()`, an object that merely has `select` on
 * it — answers nothing a policy would allow.
 */
export function boundHandles(src: string): { names: Set<string>; handleFirstFns: string[] } {
  const names = new Set<string>();
  const handleFirstFns: string[] = [];
  const param = /\(\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:\)\s*(?:=>|:[^=]{0,60}=>)|=>)|(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g;
  for (const helper of CONTEXT_HELPERS) {
    const call = new RegExp(`\\b${helper}\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = call.exec(src)) !== null) {
      const tail = src.slice(m.index + m[0].length);
      param.lastIndex = 0;
      const p = param.exec(tail);
      const name = p?.[1] ?? p?.[2];
      if (name && name !== 'async') names.add(name);
    }
  }
  const decl = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?:=>|:\s*Promise)/g;
  let d: RegExpExecArray | null;
  while ((d = decl.exec(src)) !== null) {
    const params = d[2] ?? d[4];
    if (!params || !HANDLE_TYPE.test(params)) continue;
    for (const raw of params.split(',')) {
      const name = raw.trim().split(/[:?\s]/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
    const fnName = d[1] ?? d[3];
    if (fnName && HANDLE_TYPE.test(params.split(',')[0] ?? '')) handleFirstFns.push(fnName);
  }
  return { names, handleFirstFns };
}

// ── finding the reads ────────────────────────────────────────────────────────

export type Read = {
  js: string;
  sql: string;
  line: number;
  handle: string;
  isQuery: boolean;
  statement: string;
};

const HANDLE_RE = /([A-Za-z_$][\w$]*)\s*\.\s*(?:select|insert|update|delete|query|execute)\s*[(<.]/g;

/**
 * Does this statement reach the database, or does it merely name a column? A
 * `const TICKET_PROJECTION = { id: supportTickets.id }` is a column map that
 * some query below uses; flagging the map would report the same read twice and
 * teach whoever hits it to distrust the output.
 */
const QUERY_RE = /\.(?:select|insert|update|delete|from|where|values|returning|execute|onConflict)\s*[(.<]|\bsql\s*`|\bdb\s*\.\s*query\b/;

/** The handle a chain hangs off: the last `<ident>.select(` before this offset. */
export function handleFor(statement: string, refOffset: number): string | undefined {
  HANDLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last: { index: number; name: string } | undefined;
  while ((m = HANDLE_RE.exec(statement)) !== null) {
    if (m.index >= refOffset) break;
    last = { index: m.index, name: m[1] };
  }
  return last?.name;
}

/** Every use of a tenant-keyed table, one per (statement, table). */
export function findReads(src: string, tables: Map<string, TenantTable>): Read[] {
  const spans = splitStatements(src);
  const bySql = new Map<string, TenantTable>();
  for (const t of tables.values()) bySql.set(t.sql, t);
  const jsAlt = [...tables.keys()].sort((a, b) => b.length - a.length).join('|');
  const found: Array<{ read: Read; offset: number; stmtStart: number }> = [];
  const push = (js: string, sql: string, offset: number) => {
    const statement = spanAt(spans, offset);
    if (!statement) return;
    const handle = handleFor(statement.text, offset - statement.start) ?? '';
    found.push({
      offset,
      stmtStart: statement.start,
      read: {
        js, sql, line: lineOf(src, offset), handle,
        isQuery: QUERY_RE.test(statement.text), statement: statement.text,
      },
    });
  };

  const colRef = new RegExp(`\\b(${jsAlt})\\s*\\.`, 'g');
  let m: RegExpExecArray | null;
  while ((m = colRef.exec(src)) !== null) {
    const t = tables.get(m[1]);
    if (t) push(t.js, t.sql, m.index);
  }
  // `tx.update(quotes)` / `.from(invoices)` name the table with no column after
  // it, so the pattern above never sees them.
  const chainRef = /\.(?:from|update|insert|delete)\s*\(\s*([A-Za-z][\w]*)\s*\)/g;
  while ((m = chainRef.exec(src)) !== null) {
    const t = tables.get(m[1]);
    if (t) push(t.js, t.sql, m.index + m[0].indexOf(m[1]));
  }
  const queryRef = /\.query\s*\.\s*([A-Za-z][\w]*)/g;
  while ((m = queryRef.exec(src)) !== null) {
    const js = m[1];
    const t = tables.get(js) ?? [...bySql.values()].find((x) => x.sql === snakeCase(js));
    if (t) push(t.js, t.sql, m.index);
  }
  const rawRef = /\b(?:from|join|into|update)\s+([a-z][a-z0-9_]*)\b/gi;
  while ((m = rawRef.exec(src)) !== null) {
    const t = bySql.get(m[1]);
    if (!t) continue;
    const statement = spanAt(spans, m.index);
    // Only raw SQL that actually reaches the database; a `FROM` in an error
    // string or a doc comment is not a read.
    if (!statement || !/\b(?:db|tx)\s*\.\s*execute\b|\bsql\s*`/.test(statement.text)) continue;
    push(t.js, t.sql, m.index);
  }

  const seen = new Set<string>();
  const out: Read[] = [];
  for (const f of found.sort((a, b) => a.offset - b.offset)) {
    const key = `${f.stmtStart}:${f.js}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.read);
  }
  return out;
}

const snakeCase = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// ── the baseline ─────────────────────────────────────────────────────────────

export type BaselineEntry = {
  file: string;
  table: string;
  reason: string;
  deferredTo: string;
  pinnedBy: string;
};

export function loadBaseline(path = 'scripts/portal-rls-context-baseline.json'): BaselineEntry[] {
  if (!existsSync(path)) {
    throw new Error(`missing ${path} — the guard cannot verify exemptions it cannot read`);
  }
  return (JSON.parse(readFileSync(path, 'utf8')) as { entries?: BaselineEntry[] }).entries ?? [];
}

function matches(entry: BaselineEntry, file: string, read: Read): boolean {
  // No wildcard, no file-level exemption: that is the anything-goes entry this
  // guard exists to refuse.
  return entry.file === file && (entry.table === read.js || entry.table === read.sql);
}

/** Re-verify an exemption instead of trusting it; returns why it no longer holds. */
export function verifyEntry(entry: BaselineEntry, root = '.'): string | null {
  if ((entry.reason ?? '').trim().length < 40) {
    return 'a deferral needs a reason of at least 40 characters — one a reviewer can disagree with';
  }
  if (!/^#\d+$/.test(entry.deferredTo ?? '')) {
    return `deferredTo must be the issue the work is tracked in, not "${entry.deferredTo}"`;
  }
  if (!entry.pinnedBy || !existsSync(join(root, entry.pinnedBy))) {
    return `pinnedBy names ${entry.pinnedBy}, which does not exist`;
  }
  const test = readFileSync(join(root, entry.pinnedBy), 'utf8');
  if (!test.includes(entry.table)) {
    return `${entry.pinnedBy} does not mention ${entry.table} — it does not pin this deferral`;
  }
  return null;
}

// ── analysis ─────────────────────────────────────────────────────────────────

export type Violation = { file: string; table: string; line: number; problem: string };

export function analyzeSource(
  rel: string,
  raw: string,
  tables: Map<string, TenantTable>,
  baseline: BaselineEntry[],
  root = '.',
): { violations: Violation[]; reads: number; used: Set<BaselineEntry> } {
  const src = maskComments(raw);
  const { names: bound, handleFirstFns } = boundHandles(src);
  const violations: Violation[] = [];
  const used = new Set<BaselineEntry>();
  const reads = findReads(src, tables);

  for (const read of reads) {
    const problem =
      read.handle === ''
        ? read.isQuery
          ? 'a tenant-policyed table is read by a statement whose chain hangs off nothing this guard can name'
          : ''
        : read.handle === 'db'
          ? 'the bare pool `db` — withTenantContext() sets app.current_tenant on the transaction it opened, and the pool answers on a different connection'
          : bound.has(read.handle)
            ? ''
            : `\`${read.handle}\` is not bound by a context-establishing call (a db.transaction() handle carries no tenant GUCs either)`;
    if (!problem) continue;
    const entry = baseline.find((e) => matches(e, rel, read));
    if (entry) {
      const stale = verifyEntry(entry, root);
      if (stale) violations.push({ file: rel, table: read.js, line: read.line, problem: stale });
      else used.add(entry);
      continue;
    }
    violations.push({ file: rel, table: read.js, line: read.line, problem });
  }

  // A route that knows who the customer is and opens no context is the #2446
  // bug even when every query moved out to a helper this file cannot see.
  const resolvesIdentity = /\b(?:resolvePortalIdentity|resolvePortalContact|getPortalSession)\s*\(/.test(src);
  const opensContext = CONTEXT_HELPERS.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(src));
  if (resolvesIdentity && !opensContext && !baseline.some((e) => e.file === rel)) {
    violations.push({
      file: rel, table: '', line: 1,
      problem: 'resolves a portal identity but never calls a context-establishing helper (#2446)',
    });
  }

  // The pool passed where a handle was promised: the callee's first parameter
  // is typed RlsTransaction, the argument is the connection that carries no
  // GUCs, and no table reference in the file looks wrong to the rules above.
  for (const fn of handleFirstFns) {
    const callSite = new RegExp(`\\b${fn}\\s*\\(\\s*db\\s*[,)]`);
    const hit = callSite.exec(src);
    if (!hit) continue;
    violations.push({
      file: rel, table: fn, line: lineOf(src, hit.index),
      problem: `${fn}(…) takes a transaction handle but is handed the bare pool`,
    });
  }
  return { violations, reads: reads.length, used };
}

// ── the walk ─────────────────────────────────────────────────────────────────

function tsFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  const out: string[] = [];
  for (const name of readdirSync(path)) {
    const p = join(path, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

export const DEFAULT_TARGETS = ['app/api/public', 'lib/portal-auth.ts', 'lib/portal-session.ts', 'app/api/tenant/portal/login'];

export async function run(
  targets: string[],
  root = '.',
  opts: { tables?: Map<string, TenantTable>; baseline?: BaselineEntry[] } = {},
): Promise<{ violations: Violation[]; files: number; reads: number; unused: BaselineEntry[]; tableCount: number }> {
  const tables = opts.tables ?? await loadTenantTables(root);
  if (tables.size < MIN_TENANT_KEYED_TABLES) {
    throw new Error(
      `derived only ${tables.size} tenant-keyed table(s); expected at least ${MIN_TENANT_KEYED_TABLES} — ` +
      'the schema did not load, so this run proves nothing',
    );
  }
  const baseline = opts.baseline ?? loadBaseline(join(root, 'scripts/portal-rls-context-baseline.json'));
  const files = targets.flatMap((t) => tsFiles(join(root, t)));
  const violations: Violation[] = [];
  const usedEntries = new Set<BaselineEntry>();
  let reads = 0;
  for (const file of files) {
    const rel = relative(root, file).split(sep).join('/');
    const res = analyzeSource(rel, readFileSync(file, 'utf8'), tables, baseline, root);
    violations.push(...res.violations);
    reads += res.reads;
    for (const u of res.used) usedEntries.add(u);
  }
  if (files.length < MIN_SCANNED_FILES) {
    throw new Error(
      `walked ${files.length} file(s); expected at least ${MIN_SCANNED_FILES} — the portal surface ` +
      'moved or a target disappeared, and a guard that walks nothing passes everything',
    );
  }
  if (reads < MIN_TABLE_READS) {
    throw new Error(
      `found ${reads} tenant-keyed statement(s) across ${files.length} file(s); expected at least ` +
      `${MIN_TABLE_READS} — the read patterns stopped matching, so this run proves nothing`,
    );
  }
  const unused = baseline.filter((e) => !usedEntries.has(e)
    && !violations.some((v) => v.file === e.file && v.table === e.table));
  return { violations, files: files.length, reads, unused, tableCount: tables.size };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const targets = argv.filter((a) => !a.startsWith('--'));
  const { violations, files, reads, unused, tableCount } = await run(targets.length > 0 ? targets : DEFAULT_TARGETS);

  if (json) {
    console.log(JSON.stringify({ scanned: files, tenantTables: tableCount, reads, violations, unused }, null, 2));
    if (violations.length > 0) process.exit(1);
    return;
  }
  if (violations.length > 0) {
    const rows = violations.map((v) => `    ${v.file}:${v.line}  ${v.table} — ${v.problem}`);
    console.error(
      `\n\x1b[31m✖ Portal RLS-context guard failed (#2446).\x1b[0m\n` +
      `\n  ${files} file(s) scanned against ${tableCount} tenant-policyed table(s); ` +
      `${reads} statement(s) examined.\n\n${rows.join('\n')}\n\n` +
      '  Fix: wrap the work in withTenantContext(identity.tenantId, NO_USER_SENTINEL,\n' +
      '  tx => …) and use tx — or withPortalLookupContext() for the credential read\n' +
      '  that runs before a tenant is known. A bare db.* inside the callback loses the\n' +
      '  context: the pool answers on another connection. If the file really is\n' +
      '  deferred, add scripts/portal-rls-context-baseline.json an entry naming the\n' +
      '  issue it is deferred to and the test that pins it — this guard re-verifies\n' +
      '  exemptions, it does not trust them.\n',
    );
    process.exit(1);
  }
  console.log(
    `[check-portal-rls-context] OK — ${files} file(s), ${tableCount} tenant-policyed tables, ` +
    `${reads} statement(s): every policyed read is bound to a context-establishing call.`,
  );
  if (unused.length > 0) {
    console.warn(
      `\n\x1b[33m⚠ ${unused.length} baseline entr(y/ies) no longer match anything — remove them:\x1b[0m\n` +
      unused.map((e) => `    - ${e.file} ${e.table}`).join('\n') + '\n',
    );
  }
}

// Only when run directly: the unit suite imports these functions.
if (process.argv[1]?.includes('check-portal-rls-context')) {
  main().catch((err) => {
    console.error(`[check-portal-rls-context] ${(err as Error).message}`);
    process.exit(1);
  });
}
