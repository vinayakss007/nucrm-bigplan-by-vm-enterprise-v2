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
 * Rule: inside the portal's request surface, a table that carries a tenant policy
 * may only be reached through a handle that a context-establishing call bound
 * (`withTenantContext`, `withPortalLookupContext`, …). The surface is DERIVED from
 * `proxy.ts`'s own `PUBLIC_PATHS`/`PUBLIC_PREFIXES` (#3186) and unioned with the
 * routes and library files only a name can reach — it used to be a hand-written
 * directory list, and #3163's capture path and #3182's invitation routes were both
 * invisible to it for exactly that reason. The bare pool `db` is never such a
 * handle, inside a callback or outside it: `lib/db/pool.ts` hands
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
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getTableColumns, getTableName } from 'drizzle-orm';
// The anonymous surface is one fact with one source of truth. #3186: this guard
// used its own directory list while its sibling had read `proxy.ts` since #2232.
import { publicApiPaths, resolveScope } from './check-public-row-projection.mts';

// ── the policyed set, derived ────────────────────────────────────────────────

export type TenantTable = { js: string; sql: string };

/** A derived set this small means the schema stopped loading, not the product. */
export const MIN_TENANT_KEYED_TABLES = 100;
/**
 * The floor is the derived anonymous surface measured on the day #3186 landed:
 * every `app/<path>` that `proxy.ts` advertises, plus the portal-auth libraries,
 * the Resend attribution library and the hand-named routes below. Pinned at the
 * current surface on purpose: a floor left at 22 would say OK the day the
 * derivation quietly stops matching `PUBLIC_PATHS` and the walk falls back to the
 * hand list, which is the exact failure #3186 was filed for. It moves when the
 * surface moves, and only with the walk that produced the new number — 104 since
 * #3246 step 4a pinned the inbound key lookup, 106 since step 4b pinned the
 * Resend attribution and the write handlers it feeds, both of which the route's
 * size ratchet pushed into `lib/`, and 107 since #3280 put `/api/setup/status` in
 * `PUBLIC_PATHS` so an operator can ask an unauthenticated box whether it still
 * needs its first admin.
 */
export const MIN_SCANNED_FILES = 107;
/**
 * Tenant-keyed statements the same walk examines (measured 229 after #3195 took
 * the bare-pool CRM aggregate out of app/api/metrics; 231 with the two Resend
 * libraries #3246 step 4b pinned). Below this
 * the read patterns stopped working, or the scope shrank to the hand list.
 */
export const MIN_TABLE_READS = 200;

/**
 * Every call that binds a handle with RLS GUCs set: six from `lib/db/rls.ts`,
 * `withPortalLookupContext` from `lib/db/portal-lookup-context.ts` (where
 * #2472 moved it to stay under the #1843 line ratchet),
 * `withFormLookupContext` from `lib/db/form-capture-context.ts` (#3163's
 * anonymous form-render/capture lookup) and `withUnsubscribeContactContext` from
 * `lib/db/unsubscribe-contact-context.ts` (#3237's pre-auth contact claim), plus
 * `withPluginWebhookLookupContext` from `lib/db/plugin-webhook-context.ts` (#3246's
 * pre-auth plugin webhook lookup). The
 * guard matches on the *call name* at each site, so the split changes nothing it
 * can see — this list is only where the names come from.
 */
export const CONTEXT_HELPERS = [
  'withTenantContext',
  'withSecurityContext',
  'withUserContext',
  'withAuthLookupContext',
  'withAuthResolutionContext',
  'withTrackingLookupContext',
  'withPortalLookupContext',
  'withFormLookupContext',
  'withUnsubscribeContactContext',
  'withPluginWebhookLookupContext',
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
 *
 * Regex literals are skipped over, not blanked. They cannot be blanked (a guard
 * that erases code is not reading the code), but they must not be parsed as
 * strings either: `escapeHtmlEntities` ends in `.replace(/'/g, '&#x27;')`, and
 * an apostrophe that opens a "string" runs to the next quote in the file, which
 * leaves every `//` comment between them visible. Measured on
 * `app/api/leads/public/route.ts` before #3163 widened this guard's targets: the
 * phantom string started at :44 and the next quote was the `''` of a comment at
 * :103, so the prose at :89 — "a non-uuid reached `eq(forms.id, …)`" — was
 * reported as a bare-pool read of `forms`. A false positive here is not noise:
 * the only way to silence it is a baseline entry, and the baseline exists to
 * hold real deferrals.
 */
export function maskComments(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  const n = src.length;
  // Where `/` can only be a regex: division needs an operand before it, so a
  // letter, digit, `_`, `$`, `)`, `]` or `}`-of-an-object-literal means divide.
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
        // `[` is literal inside a class, and `/` closes one it never opened.
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
 *
 * `query` is matched on ANY handle: with the old `\bdb\s*\.\s*query\b`, moving a
 * relational read from `db` onto `tx` dropped it out of the policed set entirely
 * — measured on the offers route's `contacts` read in #2468.
 */
const QUERY_RE = /\.(?:select|insert|update|delete|from|where|values|returning|execute|onConflict)\s*[(.<]|\bsql\s*`|\.\s*query\s*\.\s*[A-Za-z_$]/;

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

/**
 * The hand-named half of the surface: two library files and the routes the
 * widening PRs proved one at a time.
 *
 * `lib/portal-auth.ts` and `lib/portal-session.ts` are libraries, not routes, and
 * no `PUBLIC_PATHS` entry names them — so the derived list can only ever be a
 * UNION with this one (#3186's first constraint). The rest are the capture paths
 * #3163 found outside the guard and the two team-invitation routes #3182 fixed;
 * they are also in `proxy.ts`, and saying so twice costs nothing, while dropping
 * them would silently narrow coverage if an edge entry is ever rephrased.
 */
export const PINNED_TARGETS = [
  'lib/portal-auth.ts',
  'lib/portal-session.ts',
  'lib/webhooks/inbound-auth.ts',
  'lib/email/webhook-scope.ts',
  'lib/email/resend-event-handlers.ts',
  'app/api/public',
  'app/api/tenant/portal/login',
  'app/api/forms/submit',
  'app/api/tenant/forms/public',
  'app/api/leads/public',
  'app/api/auth/accept-invite',
  'app/api/auth/invite-details',
];

/**
 * Everything `proxy.ts` advertises as anonymous, as `app/<path>` directories.
 *
 * #3186: the guard used to answer "what is the portal surface?" from a list
 * someone had to remember to edit, and the history says nobody does — #3163's
 * capture path and #3182's invitation routes were both invisible to it, and both
 * were fixed by *adding a line*. Its sibling guard `check-public-row-projection`
 * has read the edge's own `PUBLIC_PATHS`/`PUBLIC_PREFIXES` since #2232; #3179
 * just landed the content-derived version of the same fix for `apply-rls-ci`.
 * Measured with this function at `7ff9dc24f`: 53 public dirs, 11 walked.
 */
export function publicScopeDirs(root: string): string[] {
  const proxyFile = join(root, 'proxy.ts');
  if (!existsSync(proxyFile)) {
    throw new Error(`${proxyFile} is missing — the anonymous surface cannot be derived`);
  }
  const paths = publicApiPaths(readFileSync(proxyFile, 'utf8'));
  if (paths.length === 0) {
    throw new Error(
      'no /api/ entry was matched in PUBLIC_PATHS / PUBLIC_PREFIXES — the edge lists were not '
      + 'parsed, so this scope proves nothing',
    );
  }
  const { dirs } = resolveScope(root, paths);
  if (dirs.length === 0) {
    throw new Error(`none of the ${paths.length} public /api/ paths resolves to app/<path> — nothing audited`);
  }
  return dirs;
}

/** The scope the guard runs with: the derived surface, plus what only a name can reach. */
export function buildTargets(root: string): string[] {
  return [...new Set([...publicScopeDirs(root), ...PINNED_TARGETS])].sort();
}

/**
 * Findings the walk reports on a caller this guard cannot judge yet, deferred by
 * directory and RATCHETTED by count.
 *
 * Widening the scope to the whole anonymous surface does not mean every finding
 * is the #2446 bug — most of the 114 measured here are a different question:
 * `app/api/cron/*` iterates tenants deliberately (#2539's lock work, #2540's
 * backup role), `app/api/webhooks/*` authenticates by signing secret and must
 * resolve a tenant from a provider payload, and `auth/sso` redeems a credential
 * before a tenant is known — which is
 * a pre-auth lookup-arm decision, tracked in #3246 since #3102 closed, not a
 * missing `withTenantContext()` call. Claiming them as #2446 breaks would be a
 * false alarm; pretending the guard cannot see them would re-open the hole
 * #3186 is about.
 *
 * So a deferral is a *counted* exemption: `maxFindings` is the measured size of
 * the class today, and the guard fails on a deferral that grew (a new unbound
 * read joined a deferred directory) or one that went to zero (the class was
 * fixed, and the directory must come back into scope). Per-file `verifyEntry`
 * stays the only way to excuse a single statement; these excuse no statement in
 * a route that has since been fixed — the count has to stay honest.
 *
 * The third bucket — reads by a caller whose identity the route already verified,
 * which is the #2446 bug itself — is NOT deferred here. Widening the scope found
 * two (#3196 `/api/flags`, #3197 `/api/track/event`) and both are fixed at the
 * call site in this file's own PR, with the guard as the test that keeps them
 * fixed.
 *
 * `app/api/metrics` was the third entry in this ledger when #3186 wrote it, and
 * it is GONE as of #3195: the route no longer reads a tenant-policyed table at
 * all, so the directory is back in scope and the count ratchet is what says so.
 * That is the ledger working as designed — a deferral is a claim about today,
 * and an entry that excuses nothing is reported as a finding rather than left to
 * rot. What #3195 did NOT do is invent the aggregate privilege the directory
 * wanted: the CRM counts are out of the scrape, not silently zero, and the
 * privilege shape stays #3246's decision.
 *
 * `app/api/auth/oauth` left the ledger from the other direction — bound rather than
 * removed-from-scope — and it took two issues to do it. #3186 measured 2 findings
 * there; #3225 wrapped `/token`'s client read and its grant writes and left `/revoke`'s
 * identical read standing at 1; #3231 wrapped that read in the same
 * `withOAuthClientLookupContext` and gave `oauth_tokens` the `access_token` claim arm
 * the entry said had to exist first. The entry's own rule — an exemption that excuses
 * nothing is itself a finding — is what turned it red, and deleting it is the honest
 * green.
 *
 * `app/api/unsubscribe` left the same way, in #3237. Its entry named #3102's privilege
 * decision as the reason three writes could not be bound, and the decision turned out
 * not to be outstanding after all: the credential is an HMAC over the contact uuid that
 * the route already verifies in code, so the grant keys on what that token certifies —
 * migration 0138's SELECT + UPDATE arm pair on `contacts` behind `app.unsubscribe_contact`,
 * opened by `withUnsubscribeContactContext` and closed by the statement that hands the
 * claimed row's tenant to the enrollment and activity writes. Those are the 3 findings,
 * and they are bound now.
 *
 * The last three entries pointed at #3102 until 2026-10-25, when it closed COMPLETED
 * (`0134`–`0137`, plus #3225/#3231/#3237). `verifyDeferral` only checks the shape of
 * `deferredTo`, never that the issue it names is still open, so the pointer went stale
 * quietly — the counts stayed at their ceilings and each entry's `why` still described
 * a decision that had been made. They now name #3246, which is the issue that actually
 * holds this work: an app-minted bearer credential is a different privilege shape from
 * a tenant derived from a provider's signing secret (`webhooks`), an issuer/state
 * handoff (`auth/sso`) or an anonymous callback URL (`plugins/webhook`), and none of the
 * three is #3102's scope retro-fitted. The entries themselves are unchanged: same dirs,
 * same 44/2/1 ceilings, same green run. What a stale pointer costs is the honest question
 * here, and the answer is that a ratchet nobody is watching still has to be pointed at
 * someone. Making the screen refuse a closed issue needs the GitHub API at guard time,
 * which is out of scope for a pointer fix and is what #3246's remaining steps are for:
 * bind each of these reads and delete the entry, the way #3225, #3231 and #3237
 * each deleted one.
 *
 * Step 2 did that for `app/api/tenant/plugins/webhook` on 2026-10-25, so the three
 * became two. Its one finding was the lookup the entry named as needing an arm first:
 * migration 0139's SELECT-only arm on `custom_plugins` behind `app.plugin_webhook_id`,
 * opened by `withPluginWebhookLookupContext`, closed by the statement that hands the
 * claimed row's tenant to the `plugin_execution_logs` write once the HMAC has passed.
 * `webhooks` (30) and `auth/sso` (2) stay deferred to #3246. Step 4a took the 2
 * `apiKeys` reads out of `webhooks`' 44: the inbound key lookup now runs through
 * 0099's `app.auth_lookup` arm in `lib/webhooks/inbound-auth.ts`, which is a pinned
 * target of this guard rather than a deferred directory. Step 4b took the 12 Resend
 * reads out of what was left, and they left the directory rather than being excused
 * in place: the attribution reads `email_tracking` through 0105's
 * `app.tracking_lookup` arm and adopts the workspace it resolves, and the write
 * handlers run each statement inside `withTenantContext`. Both halves live in
 * `lib/email/` because the route's 500-line cap had no room left, so both are
 * pinned targets too. What remains in `webhooks` is `inbound` (24) and `payu` (6).
 */
export type ScopeDeferral = {
  dir: string;
  deferredTo: string;
  why: string;
  maxFindings: number;
};

export const SCOPE_DEFERRALS: ScopeDeferral[] = [
  {
    dir: 'app/api/cron',
    deferredTo: '#2539',
    why: 'Scheduled jobs authenticate by cron secret and then iterate every tenant deliberately; '
      + 'the per-tenant context loop is the work #2539 tracks, and these reads are its, not a route '
      + 'that forgot withTenantContext().',
    maxFindings: 59,
  },
  {
    dir: 'app/api/webhooks',
    deferredTo: '#3246',
    why: 'Provider callbacks verify a signing secret and must derive the tenant from the payload, '
      + 'which is the pre-auth lookup-arm decision #3246 now tracks; a signature proves the sender, '
      + 'not the tenant, so no GUC exists to set before that resolution happens.',
    maxFindings: 30,
  },
  {
    dir: 'app/api/auth/sso',
    deferredTo: '#3246',
    why: 'The IdP handoff resolves ssoProviders by issuer/state before a tenant or user is known; '
      + 'that read is #3246\'s lookup arm, not a missing transaction context, and inventing a GUC '
      + 'for it is not this guard\'s call.',
    maxFindings: 2,
  },
];

/** Why a deferral is not admissible; returns the reason, or null. */
export function verifyDeferral(entry: ScopeDeferral): string | null {
  if (!entry.dir || entry.dir.includes('..') || entry.dir.startsWith('/')) {
    return `dir must be a repository-relative directory, not "${entry.dir}"`;
  }
  if (!/^#\d+$/.test(entry.deferredTo ?? '')) {
    return `${entry.dir}: deferredTo must be the issue the work is tracked in, not "${entry.deferredTo}"`;
  }
  if ((entry.why ?? '').trim().length < 40) {
    return `${entry.dir}: a deferral needs a reason of at least 40 characters — one a reviewer can disagree with`;
  }
  if (!Number.isInteger(entry.maxFindings) || entry.maxFindings < 1) {
    return `${entry.dir}: maxFindings must be a positive count — a deferral pinned at 0 excuses nothing`;
  }
  return null;
}

export type Deferred = { dir: string; deferredTo: string; count: number; maxFindings: number };

/**
 * Split findings into what the guard reports and what a counted deferral covers,
 * and fail closed on both ways a deferral can rot.
 */
export function applyDeferrals(
  violations: Violation[],
  deferrals: ScopeDeferral[] = SCOPE_DEFERRALS,
): { kept: Violation[]; deferred: Deferred[] } {
  const kept: Violation[] = [];
  const deferred: Deferred[] = [];
  // Only an admissible entry covers a directory: a deferral that cannot be
  // validated reports itself and leaves everything under it on the record.
  const covered: string[] = [];
  for (const entry of deferrals) {
    const invalid = verifyDeferral(entry);
    if (invalid) {
      kept.push({ file: 'scripts/check-portal-rls-context.mts', table: entry.dir, line: 1, problem: `deferral is not admissible — ${invalid}` });
      continue;
    }
    covered.push(entry.dir);
    const hit = violations.filter((v) => v.file === entry.dir || v.file.startsWith(`${entry.dir}/`));
    if (hit.length === 0) {
      kept.push({
        file: entry.dir, table: '', line: 1,
        problem: `the deferral for ${entry.dir} (${entry.deferredTo}) excuses nothing — no unbound read `
          + 'is reported there, so the directory is back in scope and the entry must go',
      });
      continue;
    }
    if (hit.length > entry.maxFindings) {
      kept.push({
        file: entry.dir, table: hit[0]!.table, line: hit[0]!.line,
        problem: `the deferral for ${entry.dir} is pinned at ${entry.maxFindings} contextless read(s) `
          + `(${entry.deferredTo}) and ${hit.length} were found — a new unbound read joined a deferred `
          + 'surface: fix it, or widen the pin deliberately with the count that was measured',
      });
      continue;
    }
    deferred.push({ dir: entry.dir, deferredTo: entry.deferredTo, count: hit.length, maxFindings: entry.maxFindings });
  }
  for (const v of violations) {
    if (!covered.some((dir) => v.file === dir || v.file.startsWith(`${dir}/`))) kept.push(v);
  }
  return { kept, deferred };
}

export const DEFAULT_TARGETS = buildTargets(join(dirname(fileURLToPath(import.meta.url)), '..'));

export async function run(
  targets: string[],
  root = '.',
  opts: { tables?: Map<string, TenantTable>; baseline?: BaselineEntry[]; deferrals?: ScopeDeferral[] } = {},
): Promise<{
  violations: Violation[];
  files: number;
  reads: number;
  unused: BaselineEntry[];
  tableCount: number;
  deferred: Deferred[];
}> {
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
  // `unused` is judged against the raw findings: a baseline entry that covers a
  // read inside a deferred directory is still doing its job there.
  const unused = baseline.filter((e) => !usedEntries.has(e)
    && !violations.some((v) => v.file === e.file && v.table === e.table));
  const { kept, deferred } = applyDeferrals(violations, opts.deferrals ?? SCOPE_DEFERRALS);
  return { violations: kept, files: files.length, reads, unused, tableCount: tables.size, deferred };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const targets = argv.filter((a) => !a.startsWith('--'));
  const { violations, files, reads, unused, tableCount, deferred } = await run(targets.length > 0 ? targets : DEFAULT_TARGETS);

  if (json) {
    console.log(JSON.stringify({
      scanned: files, tenantTables: tableCount, reads, violations, unused,
      deferredFindings: deferred.reduce((n, d) => n + d.count, 0), deferrals: deferred,
    }, null, 2));
    if (violations.length > 0) process.exit(1);
    return;
  }
  if (violations.length > 0) {
    const rows = violations.map((v) => `    ${v.file}:${v.line}  ${v.table} — ${v.problem}`);
    console.error(
      `\n\x1b[31m✖ Portal RLS-context guard failed (#2446).\x1b[0m\n` +
      `\n  ${files} file(s) scanned against ${tableCount} tenant-policyed table(s); ` +
      `${reads} statement(s) examined; ${deferred.length} counted deferral(s) hold ` +
      `${deferred.reduce((n, d) => n + d.count, 0)} more.\n\n${rows.join('\n')}\n\n` +
      '  Fix: wrap the work in withTenantContext(identity.tenantId, NO_USER_SENTINEL,\n' +
      '  tx => …) and use tx — or withPortalLookupContext() for the credential read\n' +
      '  that runs before a tenant is known. A bare db.* inside the callback loses the\n' +
      '  context: the pool answers on another connection. If the file really is\n' +
      '  deferred, add scripts/portal-rls-context-baseline.json an entry naming the\n' +
      '  issue it is deferred to and the test that pins it — this guard re-verifies\n' +
      '  exemptions, it does not trust them. A whole DIRECTORY is only ever deferred\n' +
      '  by SCOPE_DEFERRALS, and its pin is a count that is not allowed to grow.\n',
    );
    process.exit(1);
  }
  console.log(
    `[check-portal-rls-context] OK — ${files} file(s), ${tableCount} tenant-policyed tables, ` +
    `${reads} statement(s): every policyed read is bound to a context-establishing call` +
    (deferred.length > 0
      ? `, bar ${deferred.reduce((n, d) => n + d.count, 0)} read(s) in ${deferred.length} counted `
        + `deferral(s): ${deferred.map((d) => `${d.dir} ${d.count}/${d.maxFindings} → ${d.deferredTo}`).join(', ')}.`
      : '.'),
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
