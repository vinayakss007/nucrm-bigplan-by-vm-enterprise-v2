/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Partial-unique-index guard (#3406).
 *
 * Soft delete is an application convention: 204 of 226 tables carry `deleted_at`,
 * and a unique surface that does not exclude tombstones therefore makes a deleted
 * row keep its key reserved forever. Delete a team named "Sales", type "Sales"
 * again, and the insert dies with `23505` on `idx_teams_tenant_name` — the user
 * sees "name already taken" for a name the UI does not show them anywhere.
 *
 * The rule this screen enforces: **every unique surface on a soft-deletable table
 * must be partial on `deleted_at`.** Uniqueness then means "unique among live
 * rows", which is what every caller already assumes, and restoring a tombstone
 * whose key has since been taken fails loudly (`23505` at restore) instead of
 * silently producing two live rows — the direction the audit asked for.
 *
 * A few unique surfaces genuinely must stay absolute, and they are the interesting
 * ones, so they are declared with a reason in `scripts/partial-unique-absolute.json`
 * rather than exempted by directory or filename:
 *
 *   - one-time tokens and credential hashes (`password_resets.token`,
 *     `refresh_tokens.token`, `api_keys.key_hash`, `invitations.token`,
 *     `support_tickets.portal_token`): the whole point of the unique index is that
 *     a presented secret resolves to exactly one row, tombstones included. Partial
 *     would let a revoked token be re-issued while its dead twin still authenticates.
 *   - provider event ids (`billing_events.stripe_event_id`,
 *     `whatsapp_messages` external id): webhook idempotency. The provider re-delivers
 *     an event it already delivered; if our dedupe arm ignores tombstones the
 *     redelivery is processed a second time — twice the money in the ledger.
 *   - singleton-per-entity config and aggregate rows (`system_settings.key`,
 *     `plan_limits.plan_id`, `ai_usage_aggregated`, …): those rows are upserted, not
 *     trashed, and partiality would let a deleted aggregate and a live one describe
 *     the same period.
 *
 * Baseline entries are RE-VERIFIED every run: an entry whose surface has since
 * become partial, or no longer exists, fails the screen. An exemption cannot
 * outlive its code — the same shrink-only discipline as
 * `scripts/pool-tls-baseline.json` (#3381).
 *
 * The second pass reads `drizzle/schema/*.ts`. A partial index that exists only in
 * SQL is undone by the next `drizzle-kit generate`: the schema is what the generator
 * diffs, so every surface in the DB-side partial set must be declared partial there
 * too, or this fix is one generated migration away from disappearing.
 *
 * The third pass reads the call sites. `ON CONFLICT (cols)` cannot infer a partial
 * index unless the statement restates its predicate, so every upsert aimed at a
 * surface in the partial set must pass `targetWhere` — a missing one is a 42P10 route
 * failure, in whatever route, months after the migration that caused it.
 *
 * Usage: npm run guard:partial-unique [--json] [root]
 *   root defaults to the repo; pass a directory holding a `drizzle/migrations`
 *   subtree to feed the screen a fixture.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ABSOLUTE_FILE = 'scripts/partial-unique-absolute.json';

export type Surface = {
  table: string;
  kind: 'index' | 'constraint' | 'column';
  name: string;
  columns: string;
  where: string | null;
  declaredIn: string;
};

export type Finding = { surface: Surface; reason: string };

const MIGRATION_FILE = /^[0-9]{4}_[^/]*\.sql$/;
/** Strip `--` line comments without eating `--` inside quoted literals. */
const LINE_COMMENT = /(^|[^\\])--[^\n]*/g;
// An optional `schema.` prefix, consumed atomically. Writing it as the loose
// `"?[\w.]*\.)?` form reads wrong: the `[\w.]` class cannot cross the closing
// quote of `"public"`, so the optional group matches nothing and the *table*
// capture swallows the schema name — every `"public"."teams"` surface was then
// filed under a table called `public`, silently dropping 151 index statements
// from the census. The dot has to be part of the group that eats the quotes.
const SCHEMA = '(?:"\\w+"\\.|\\w+\\.|)';
const TBL = '"?(\\w+)"?';
// CREATE UNIQUE INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON [ONLY] table[.col] [USING method] (cols) [WHERE …]
const CREATE_UNIQUE_INDEX =
  new RegExp(`CREATE\\s+UNIQUE\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?"?([\\w]+)"?\\s+ON\\s+(?:ONLY\\s+)?${SCHEMA}${TBL}(?:\\.?[\\w"]+)?\\s*(?:USING\\s+\\w+\\s*)?\\(([^)]*)\\)([^;]*);`, 'gi');
const CREATE_TABLE = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${SCHEMA}${TBL}\\s*\\(([\\s\\S]*?)\\n\\);`, 'gi');
const ADD_COLUMN = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${SCHEMA}${TBL}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?(deleted_at)"?`, 'gi');
const ADD_CONSTRAINT =
  new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${SCHEMA}${TBL}[^;]*?ADD\\s+CONSTRAINT\\s+"?([\\w]+)"?\\s+UNIQUE\\s*\\(([^)]*)\\)`, 'gi');
const DROP_INDEX = new RegExp(`DROP\\s+INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+EXISTS\\s+)?${SCHEMA}${TBL}`, 'gi');
const DROP_CONSTRAINT = /DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(?:"?[\w.]*\.)?"?([\w]+)"?/gi;

function stripComments(sql: string): string {
  return sql.replace(LINE_COMMENT, '$1');
}

function unquote(s: string): string {
  return s.replace(/"/g, '').trim();
}

/** The `WHERE …` tail of a CREATE INDEX, or null when the index is not partial. */
function whereOf(tail: string): string | null {
  const m = /\bWHERE\s+([\s\S]*)$/i.exec(tail.trim());
  return m ? unquote(m[1]!).replace(/\s+/g, ' ') : null;
}

function isPartial(where: string | null): boolean {
  return !!where && /\bdeleted_at\b/i.test(where);
}

function migrationFiles(root: string): string[] {
  const dir = join(root, 'drizzle', 'migrations');
  if (!existsSync(dir)) throw new Error(`no drizzle/migrations under ${root}`);
  return readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f) && !f.endsWith('.down.sql'))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Replay the migration corpus and report, per table, whether it has `deleted_at`
 * and which unique surfaces exist on it. Later statements win: an index dropped by
 * 0110 must not be counted because 0000 created it.
 */
export function readCorpus(root: string): { softTables: Set<string>; surfaces: Map<string, Surface>; files: number } {
  const softTables = new Set<string>();
  const surfaces = new Map<string, Surface>();
  const files = migrationFiles(root);

  for (const file of files) {
    const txt = stripComments(readFileSync(file, 'utf8'));
    const here = relative(root, file);

    CREATE_TABLE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_TABLE.exec(txt))) {
      const table = m[1]!;
      const body = m[2]!;
      if (/^\s*"?deleted_at"?\s/im.test(body)) softTables.add(table);
      let cm: RegExpExecArray | null;
      const INLINE_CONSTRAINT = /CONSTRAINT\s+"?([\w]+)"?\s+UNIQUE\s*\(([^)]*)\)/gi;
      while ((cm = INLINE_CONSTRAINT.exec(body))) {
        surfaces.set(`${table}#${cm[1]}`, {
          table, kind: 'constraint', name: cm[1]!, columns: unquote(cm[2]!), where: null, declaredIn: here,
        });
      }
      const INLINE_COLUMN = /^\s*"([\w]+)"\s+[^,]*\bUNIQUE\b/gim;
      while ((cm = INLINE_COLUMN.exec(body))) {
        surfaces.set(`${table}#column:${cm[1]}`, {
          table, kind: 'column', name: `${table}_${cm[1]}_unique`, columns: `"${cm[1]!}"`, where: null, declaredIn: here,
        });
      }
    }

    ADD_COLUMN.lastIndex = 0;
    while ((m = ADD_COLUMN.exec(txt))) if (m[2] === 'deleted_at') softTables.add(m[1]!);

    CREATE_UNIQUE_INDEX.lastIndex = 0;
    while ((m = CREATE_UNIQUE_INDEX.exec(txt))) {
      const [ , name, table, columns, tail ] = m;
      surfaces.set(`${table}#${name}`, {
        table: table!, kind: 'index', name: name!, columns: unquote(columns!), where: whereOf(tail!), declaredIn: here,
      });
    }

    ADD_CONSTRAINT.lastIndex = 0;
    while ((m = ADD_CONSTRAINT.exec(txt))) {
      surfaces.set(`${m[1]}#${m[2]}`, {
        table: m[1]!, kind: 'constraint', name: m[2]!, columns: unquote(m[3]!), where: null, declaredIn: here,
      });
    }

    DROP_INDEX.lastIndex = 0;
    while ((m = DROP_INDEX.exec(txt))) {
      for (const [key, s] of surfaces) if (s.kind === 'index' && s.name === m[1]) surfaces.delete(key);
    }
    DROP_CONSTRAINT.lastIndex = 0;
    while ((m = DROP_CONSTRAINT.exec(txt))) {
      for (const [key, s] of surfaces) if (s.kind === 'constraint' && s.name === m[1]) surfaces.delete(key);
    }
  }

  return { softTables, surfaces, files: files.length };
}

export function readAbsolute(root = ROOT): Map<string, string> {
  const path = join(root, ABSOLUTE_FILE);
  if (!existsSync(path)) return new Map();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  return new Map(Object.entries(raw));
}

/**
 * Every `uniqueIndex('<name>')` builder in drizzle/schema, with the `.where(...)`
 * text that follows it before the next builder call. Drizzle's builder is a chain,
 * so the where clause is the only partiality evidence available without instantiating
 * the ORM — and it is enough, because the generator reads exactly this text.
 */
export function readSchemaIndexDeclarations(root = ROOT): Map<string, { where: string | null; file: string; unique: boolean }> {
  const dir = join(root, 'drizzle', 'schema');
  const out = new Map<string, { where: string | null; file: string; unique: boolean }>();
  if (!existsSync(dir)) return out;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!entry.endsWith('.ts')) continue;
      const txt = readFileSync(p, 'utf8');
      const start = /(?<kind>uniqueIndex|index)\(\s*'([\w]+)'\s*\)/g;
      const nextBuilder = /\b(?:uniqueIndex|index|foreignKey|check)\(/g;
      let m: RegExpExecArray | null;
      while ((m = start.exec(txt))) {
        const isUnique = m![1] === 'uniqueIndex';
        nextBuilder.lastIndex = m.index + m[0].length;
        const nxt = nextBuilder.exec(txt);
        const block = txt.slice(m.index, nxt ? nxt.index : Math.min(txt.length, m.index + 600));
        const wm = /\.where\(\s*sql`([\s\S]*?)`\s*\)/.exec(block);
        const dynamic = /deletedAt|deleted_at/.test(block) && !!wm;
        const prev = out.get(m![2]!);
        if (prev && prev.unique && !isUnique) continue;
        out.set(m![2]!, { where: wm ? wm[1]!.trim() : dynamic ? '<column-ref>' : null, file: relative(root, p), unique: isUnique });
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * A third consequence of partiality, and the one that bites at runtime rather than
 * at migration time: `ON CONFLICT (cols)` infers its index by *name-equivalence*,
 * and a partial index is only a valid inference target when the statement also
 * carries the predicate (`ON CONFLICT … WHERE deleted_at IS NULL`). Every upsert
 * pointed at a surface converted here must therefore pass `targetWhere`, or it
 * fails with 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
 * specification") the first time it runs — long after this file was merged.
 */
export type ConflictSite = {
  file: string;
  line: number;
  table: string | null;
  columns: string[];
  hasTargetWhere: boolean;
};

const CAMEL = /([a-z0-9])([A-Z])/g;
const snake = (s: string) => s.trim().replace(CAMEL, '$1_$2').toLowerCase();

/** TS export identifier → declared table name, so `insert(schema.tenantMembers)` resolves. */
export function readTableIdents(root = ROOT): Map<string, string> {
  const out = new Map<string, string>();
  const dir = join(root, 'drizzle', 'schema');
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.ts')) continue;
    const txt = readFileSync(join(dir, entry), 'utf8');
    for (const m of txt.matchAll(/export const (\w+)\s*=\s*pgTable\(\s*'([\w]+)'/g)) out.set(m[1]!, m[2]!);
  }
  return out;
}

/**
 * Replace the *content* of comments with spaces, byte-for-byte, so a bracket
 * written in prose cannot distort a scanner's offsets. `//` runs are blanked to
 * the newline; `/* … *\/` spans are blanked across lines.
 */
export function blankComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** The `{ … }` object that starts at `open`, braces being balanced by `${`/`}` too. */
function balancedObject(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}

/**
 * Every `onConflictDoUpdate({…})` / `onConflictDoNothing({…})` options object in
 * the app, with its conflict columns and whether `targetWhere` sits beside them.
 * A site whose insert target cannot be resolved to a declared table (a dynamic
 * table reference) is reported with `table: null` and never asserted.
 */
export function readConflictSites(root = ROOT): ConflictSite[] {
  const idents = readTableIdents(root);
  const out: ConflictSite[] = [];
  for (const group of ['app', 'lib', 'scripts', 'components']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const txt = blankComments(readFileSync(p, 'utf8'));
        if (!txt.includes('onConflict')) continue;
        for (const m of txt.matchAll(/onConflict(DoUpdate|DoNothing)\s*\(\s*\{/g)) {
          const open = txt.indexOf('{', m.index!);
          const body = balancedObject(txt, open);
          const tm = /target:\s*(\[[^\]]*\]|[A-Za-z_][\w.]*)/.exec(body);
          if (!tm) continue;
          const cols = tm[1]!.replace(/^\[|\]$/g, '').split(',').filter(Boolean).map((c) => snake(c.split('.').pop() ?? c));
          const before = txt.slice(Math.max(0, m.index! - 700), m.index!);
          const ins = [...before.matchAll(/insert\(\s*(?:schema\.)?([\w]+)/g)].pop();
          const table = ins ? (idents.get(ins[1]!) ?? null) : null;
          out.push({
            file: relative(root, p),
            line: txt.slice(0, m.index!).split('\n').length,
            table,
            columns: cols.sort(),
            hasTargetWhere: /targetWhere:/.test(body),
          });
        }
      }
    };
    walk(dir);
  }
  return out;
}

export type Report = {
  totals: { migrations: number; softTables: number; uniqueOnSoft: number; partial: number; absolute: number; conflictSites: number };
  findings: Finding[];
  schemaFindings: { surface: Surface; problem: string }[];
  staleExemptions: { name: string; reason: string; note: string }[];
  upsertFindings: { site: ConflictSite; surface: Surface }[];
};

export function analyze(root = ROOT): Report {
  const { softTables, surfaces, files } = readCorpus(root);
  const absolute = readAbsolute(root);
  const schema = readSchemaIndexDeclarations(root);

  const onSoft = [...surfaces.values()].filter((s) => softTables.has(s.table));
  const findings: Finding[] = [];
  const staleExemptions: Report['staleExemptions'] = [];
  let partial = 0;

  for (const surface of onSoft) {
    if (isPartial(surface.where)) {
      partial++;
      const reason = absolute.get(surface.name);
      if (reason) {
        staleExemptions.push({ name: surface.name, reason, note: 'the surface is already partial on deleted_at; the exemption is stale' });
      }
      continue;
    }
    if (absolute.has(surface.name)) continue;
    findings.push({ surface, reason: `unique ${surface.kind} "${surface.name}" on (${surface.columns}) does not exclude tombstones` });
  }

  for (const [name, reason] of absolute) {
    const stillThere = onSoft.some((s) => s.name === name && !isPartial(s.where));
    if (!stillThere && !staleExemptions.some((x) => x.name === name)) {
      staleExemptions.push({ name, reason, note: 'no non-partial unique surface by this name exists in the corpus; the exemption is stale' });
    }
  }

  const schemaFindings: Report['schemaFindings'] = [];
  for (const surface of onSoft) {
    if (!isPartial(surface.where)) continue;
    const decl = schema.get(surface.name);
    if (!decl) {
      if (surface.kind === 'index') {
        schemaFindings.push({ surface, problem: 'partial in the database but no `uniqueIndex(…)` of that name in drizzle/schema — the next generated migration can undo it' });
      }
      continue;
    }
    if (!decl.unique) {
      schemaFindings.push({ surface, problem: `declared in ${decl.file} as a plain index() while the database enforces uniqueness — a generated migration would drop the unique arm` });
      continue;
    }
    if (!decl.where || !/deletedAt|deleted_at/.test(decl.where)) {
      schemaFindings.push({ surface, problem: `declared in ${decl.file} with no .where() on deletedAt — the next generated migration can undo it` });
    }
  }

  const colKey = (s: Surface) => `${s.table}|${s.columns.split(',').map((c) => c.trim().replace(/"/g, '')).sort().join(',')}`;
  const partialByKey = new Map<string, Surface>();
  for (const surface of onSoft) if (isPartial(surface.where)) partialByKey.set(colKey(surface), surface);

  const sites = readConflictSites(root);
  const upsertFindings: Report['upsertFindings'] = [];
  for (const site of sites) {
    if (!site.table || site.hasTargetWhere) continue;
    const surface = partialByKey.get(`${site.table}|${[...site.columns].sort().join(',')}`);
    if (surface) upsertFindings.push({ site, surface });
  }

  return {
    totals: {
      migrations: files, softTables: softTables.size, uniqueOnSoft: onSoft.length,
      partial, absolute: absolute.size, conflictSites: sites.length,
    },
    findings: findings.sort((a, b) => a.surface.table.localeCompare(b.surface.table) || a.surface.name.localeCompare(b.surface.name)),
    schemaFindings: schemaFindings.sort((a, b) => a.surface.table.localeCompare(b.surface.table)),
    staleExemptions: staleExemptions.sort((a, b) => a.name.localeCompare(b.name)),
    upsertFindings: upsertFindings.sort((a, b) => a.site.file.localeCompare(b.site.file)),
  };
}

function format(report: Report): string {
  const lines: string[] = [];
  const t = report.totals;
  lines.push(
    `partial-unique-indexes: ${t.migrations} migrations, ${t.softTables} soft-deletable tables, ` +
    `${t.uniqueOnSoft} unique surfaces on them — ${t.partial} partial on deleted_at, ` +
    `${t.absolute} declared absolute, ${report.findings.length} unexplained; ` +
    `${t.conflictSites} ON CONFLICT sites, ${report.upsertFindings.length} missing targetWhere`,
  );
  for (const f of report.findings) {
    lines.push(`  MISSING  ${f.surface.table} [${f.surface.kind}] ${f.surface.name} (${f.surface.columns}) — ${f.surface.declaredIn}`);
  }
  for (const s of report.schemaFindings) {
    lines.push(`  UNBOUND  ${s.surface.table} ${s.surface.name} — ${s.problem}`);
  }
  for (const s of report.staleExemptions) {
    lines.push(`  STALE    ${s.name} — ${s.note} (reason on file: ${s.reason})`);
  }
  for (const u of report.upsertFindings) {
    lines.push(`  UNTARGETED  ${u.site.file}:${u.site.line} — onConflict on ${u.site.table}(${u.site.columns.join(', ')}) ` +
      `cannot infer the partial index "${u.surface.name}" without targetWhere (42P10 at runtime)`);
  }
  if (!report.findings.length && !report.schemaFindings.length && !report.staleExemptions.length && !report.upsertFindings.length) {
    lines.push('  every unique surface on a soft-deletable table is either partial on deleted_at or declared absolute with a reason');
  }
  return lines.join('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const root = argv.find((a) => !a.startsWith('--')) ? resolve(argv.find((a) => !a.startsWith('--')) as string) : ROOT;
  const report = analyze(root);
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(format(report));
  const bad = report.findings.length + report.schemaFindings.length + report.staleExemptions.length + report.upsertFindings.length;
  if (bad > 0) {
    console.error(`partial-unique-indexes: ${bad} finding(s) — a deleted row must not keep a key reserved (#3406)`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
