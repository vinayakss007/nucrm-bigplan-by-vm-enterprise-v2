#!/usr/bin/env npx tsx
/**
 * guard:vocab — fail when a DB CHECK constraint no longer covers what code writes.
 *
 * The bug class (documented in scripts/constraint-vocab.json): 0050's text
 * vocabularies were frozen, the code kept growing, and every divergence between
 * them is a rejected write. Half of them were swallowed, so the tables looked
 * healthy and simply stayed empty — `notifications` and `ai_activity` both held
 * zero rows for their entire history while the code reported success.
 *
 * This guard compares the LIVE constraint against the registry on three axes:
 *
 *   1. every `required` value must exist in the DB CHECK     ← the bug
 *   2. every cited writer file must still contain the literal ← registry rot
 *   3. DB values in neither list                             ← reported, not fatal
 *
 * It reads the real database rather than the migration files, because the
 * question is "what will production reject?", and a migration that exists on
 * disk but was never applied is precisely how #43 happened.
 *
 * Usage:
 *   npm run guard:vocab                       # check against the configured DB
 *   npm run guard:vocab -- --json             # machine-readable
 *   npm run guard:vocab -- --require-writers  # also fail on undocumented creep
 *
 * Exit code: 0 clean, 1 drift found, 2 could not run (no DB, bad registry).
 */
import { readFileSync } from 'node:fs';
import { withReadonlySession } from './lib/readonly-db.mts';

interface Entry {
  id: string;
  constraint: string;
  table: string;
  column: string;
  migration: string | null;
  declaredIn: string[];
  required: string[];
  legacy: string[];
  writers?: Record<string, string[]>;
  shape?: 'enum' | 'non-enum';
  note?: string[];
}

interface Registry { constraints: Entry[] }

interface Failure { id: string; kind: 'missing-in-db' | 'stale-citation' | 'constraint-absent' | 'not-enum' | 'undocumented'; detail: string }
interface Warning { id: string; detail: string }

const ROOT = new URL('..', import.meta.url).pathname;
const jsonOnly = process.argv.slice(2).includes('--json');
const strict = process.argv.slice(2).includes('--require-writers');

let registry: Registry;
try {
  registry = JSON.parse(readFileSync(`${ROOT}scripts/constraint-vocab.json`, 'utf8')) as Registry;
} catch (err) {
  console.error(`cannot read scripts/constraint-vocab.json: ${(err as Error).message}`);
  process.exit(2);
}

for (const entry of registry.constraints) {
  if (!entry.id || !entry.constraint || !entry.table || !entry.column) {
    console.error(`registry entry is missing id/constraint/table/column: ${JSON.stringify(entry.id ?? entry)}`);
    process.exit(2);
  }
}

/**
 * Pull the literal list out of a vocabulary CHECK.
 *
 * Postgres renders these as `CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))`
 * — the element cast is per value and there is deliberately NO outer
 * `::text[]` cast, because the array element type is already known from the
 * column. Anchoring on `]::` therefore never matches, which reads exactly like
 * "this constraint is not a vocabulary" and hides every real finding.
 *
 * Returns null when the constraint genuinely is not enum-shaped, which the
 * caller treats as a finding rather than a parse failure — someone may
 * legitimately have replaced a vocabulary with a pattern check.
 */
function parseEnum(def: string): string[] | null {
  const m = def.match(/=\s*ANY\s*\(ARRAY\[(.*?)\]\s*\)/s);
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'"));
}

const defs = await withReadonlySession({}, async (client) => {
  const names = registry.constraints.map((e) => e.constraint);
  const { rows } = await client.query<{ conname: string; def: string; relname: string | null }>(
    `select c.conname, pg_get_constraintdef(c.oid) as def, t.relname
       from pg_constraint c
       left join pg_class t on t.oid = c.conrelid
      where c.contype = 'c' and c.connamespace = 'public'::regnamespace and c.conname = any($1::text[])`,
    [names],
  );
  return rows;
}).catch((err) => {
  const e = err as { code?: string; message?: string };
  console.error(`cannot read pg_constraint [${e.code ?? 'ERR'}]: ${e.message}`);
  console.error('this guard asks the live database what it will reject. Start the DB, or set PROBE_DATABASE_URL to the loopback pgbouncer.');
  process.exit(2);
});

const failures: Failure[] = [];
const warnings: Warning[] = [];
const byName = new Map(defs.map((d) => [d.conname, d]));
const fileCache = new Map<string, string>();

function fileText(path: string): string {
  if (!fileCache.has(path)) {
    try { fileCache.set(path, readFileSync(`${ROOT}${path}`, 'utf8')); }
    catch { fileCache.set(path, ''); }
  }
  return fileCache.get(path) ?? '';
}

for (const entry of registry.constraints) {
  const row = byName.get(entry.constraint);
  if (!row) {
    failures.push({
      id: entry.id,
      kind: 'constraint-absent',
      detail: `no CHECK constraint named ${entry.constraint} exists in the public schema${entry.migration ? ` (introduced/updated by migration ${entry.migration})` : ''}. Either the migration was never applied to this database, or the constraint was renamed — and a renamed constraint silently stops protecting the column.`,
    });
    continue;
  }
  if (row.relname !== entry.table) {
    failures.push({ id: entry.id, kind: 'constraint-absent', detail: `${entry.constraint} is attached to ${row.relname}, registry says ${entry.table}` });
    continue;
  }

  const dbValues = parseEnum(row.def);
  if (dbValues === null) {
    if (entry.shape === 'non-enum') continue;
    failures.push({ id: entry.id, kind: 'not-enum', detail: `${entry.constraint} is not an = ANY (ARRAY[…]) vocabulary; registry expects one: ${row.def.slice(0, 120)}` });
    continue;
  }
  const dbSet = new Set(dbValues);
  const known = new Set([...entry.required, ...entry.legacy]);

  // 1. the failure that matters: code writes it, the DB rejects it.
  for (const value of entry.required) {
    if (!dbSet.has(value)) {
      failures.push({
        id: entry.id,
        kind: 'missing-in-db',
        detail: `${entry.table}.${entry.column}='${value}' is written by code but ${entry.constraint} rejects it (23514). Writers: ${citationList(entry, value) || 'none recorded — add one to the registry'}`,
      });
    }
  }

  // 2. registry rot: a cited file that no longer contains the literal.
  for (const value of entry.required) {
    for (const file of citationsFor(entry, value)) {
      const text = fileText(file);
      if (!text) {
        failures.push({ id: entry.id, kind: 'stale-citation', detail: `${value} cites ${file}, which does not exist` });
      } else if (!text.includes(`'${value}'`) && !text.includes(`"${value}"`) && !text.includes(`\`${value}\``)) {
        failures.push({ id: entry.id, kind: 'stale-citation', detail: `${file} no longer contains the literal '${value}' the registry says it writes` });
      }
    }
  }

  // 3. documented-ness of the rest of the vocabulary.
  for (const value of dbSet) {
    if (!known.has(value)) {
      warnings.push({ id: entry.id, detail: `${entry.constraint} allows '${value}', which the registry does not list as required or legacy` });
    }
  }
  for (const value of entry.legacy) {
    if (!dbSet.has(value)) {
      failures.push({ id: entry.id, kind: 'missing-in-db', detail: `${entry.constraint} no longer allows legacy '${value}'; existing rows carrying it would now violate the constraint` });
    }
  }
}

function citationsFor(entry: Entry, value: string): string[] {
  return [...entry.declaredIn, ...(entry.writers?.[value] ?? [])];
}
function citationList(entry: Entry, value: string): string { return citationsFor(entry, value).join(', '); }

if (strict) {
  for (const w of warnings) failures.push({ id: w.id, kind: 'undocumented', detail: w.detail });
}

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify({ ok: failures.length === 0, failures, warnings }, null, 2)}\n`);
} else {
  console.log(`constraint vocabulary guard — ${registry.constraints.length} constraints checked against the live database`);
  for (const entry of registry.constraints) {
    const row = byName.get(entry.constraint);
    const db = row ? parseEnum(row.def)?.length ?? 0 : 0;
    console.log(`  ${failures.some((f) => f.id === entry.id) ? 'FAIL' : 'ok  '}  ${entry.id.padEnd(28)} db=${String(db).padStart(3)}  registry_required=${entry.required.length}  legacy=${entry.legacy.length}`);
  }
  if (warnings.length) {
    console.log('\nwarnings (allowed by the DB, not in the registry):');
    for (const w of warnings) console.log(`  ${w.id}: ${w.detail}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const f of failures) console.log(`  [${f.kind}] ${f.id}\n      ${f.detail}`);
    console.log('\nfix: widen the constraint in a new migration and register it here, or stop writing the value.');
  } else {
    console.log('\nno drift: every value the code writes is accepted by the database.');
  }
}

process.exitCode = failures.length === 0 ? 0 : 1;
