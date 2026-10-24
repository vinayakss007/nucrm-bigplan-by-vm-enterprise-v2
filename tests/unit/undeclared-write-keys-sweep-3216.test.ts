/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3216 — make #3212 and #3214's measurement permanent.
 *
 * Both of those were found by hand: an AST-free sweep of every
 * `.insert(X)…/.values({...})` and `.update(X)…/.set({...})` in the tree, resolving X
 * to the table it names and asking that table which columns it declares. Drizzle
 * builds the statement from the *table's* column map, not from the object it was
 * handed, so a key the table does not declare renders as nothing — no error, no
 * warning, no log. Two fix PRs and zero CI checks later, the only thing standing
 * between this class and a third recurrence was somebody thinking to look.
 *
 * The same silent-bailout shape exists one level up in `lib/api/concurrency.ts`:
 * `if (!idCol || !updatedAtCol) return null` means an optimistic-concurrency
 * precondition on a table without `updated_at` is not merely a no-op, it is
 * invisible — the client believes it sent a precondition, and the write goes
 * through anyway. That is #3214's second half, and no check covered it either.
 *
 * So this file is the sweep, promoted into a test: it fails if a new undeclared key
 * or a new inert guard appears anywhere, and it fails if the sweep itself goes blind
 * (a refactor that turns statically-known literals into spreads or variables would
 * otherwise quietly shrink coverage to nothing and still pass).
 *
 * Scope notes, in the interest of not pretending to more than static analysis gives:
 * payloads built with `...spread`, `.values(array)`, `.set(variable)` and calls whose
 * table argument is not an imported schema symbol are counted as `unresolved` and
 * reported, never asserted on.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Table } from 'drizzle-orm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type Declared = Map<string, Set<string>>;

/** moduleKey -> (exported table name -> declared drizzle property names) */
async function loadTables(): Promise<Map<string, Declared>> {
  const dir = join(ROOT, 'drizzle/schema');
  const out = new Map<string, Declared>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue;
    const modKey = file.replace(/\.ts$/, '');
    const mod = await import(join(dir, file)) as Record<string, unknown>;
    const per: Declared = new Map();
    for (const [exported, value] of Object.entries(mod)) {
      const cols = (value as Record<symbol, Record<string, unknown>> | null)?.[Table.Symbol.Columns];
      if (!cols || typeof cols !== 'object') continue;
      per.set(exported, new Set(Object.keys(cols)));
    }
    out.set(modKey, per);
  }
  return out;
}

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, files);
    else if (/\.tsx?$/.test(entry)) files.push(p);
  }
  return files;
}

/** Comments become spaces of equal length, so every offset and line number survives. */
function blankComments(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const start = i;
      while (i < src.length && src[i] !== '\n') i++;
      blank(start, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      blank(start, Math.min(i + 2, src.length));
      continue;
    }
    i++;
  }
  return out.join('');
}

function matchBraced(src: string, open: number, o: string, c: string): { text: string } | null {
  let depth = 0;
  let inStr: string | null = null;
  let escaped = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === o) depth++;
    else if (ch === c) {
      depth--;
      if (depth === 0) return { text: src.slice(open + 1, i) };
    }
  }
  return null;
}

/** Top-level keys of an object literal body, tolerant of nesting, strings and placeholders. */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let escaped = false;
  let token = '';
  let sawColon = false;
  const flush = () => {
    const head = sawColon ? token.slice(0, token.indexOf(':')) : token;
    const ident = head.match(/^\s*([A-Za-z_$][\w$]*)\s*$/);
    if (ident) keys.push(ident[1]!);
    const quoted = head.match(/^\s*['"]([^'"]+)['"]\s*$/);
    if (quoted) keys.push(quoted[1]!);
    token = '';
    sawColon = false;
  };
  for (const ch of body) {
    if (escaped) { escaped = false; token += ch; continue; }
    if (ch === '\\') { escaped = true; token += ch; continue; }
    if (inStr) { token += ch; if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; token += ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) sawColon = true;
    else if (ch === ',' && depth === 0) { flush(); continue; }
    token += ch;
  }
  flush();
  return keys;
}

/** Which schema module each imported symbol comes from, per source file (null = the barrel). */
function importSources(src: string): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2]!;
    const fromSchema = spec.match(/drizzle\/schema\/([A-Za-z0-9_-]+)$/);
    const barrel = /@\/drizzle\/schema$|drizzle\/schema\/index$/.test(spec);
    if (!fromSchema && !barrel) continue;
    const modKey = fromSchema ? fromSchema[1]! : null;
    for (const raw of m[1]!.split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()!.trim();
      if (!name) continue;
      // An explicitly-named module wins; the barrel only fills gaps.
      if (modKey !== null || !map.has(name)) map.set(name, modKey);
    }
  }
  return map;
}

/** The predicate the sweep applies to one statement: keys the declared table does not have. */
function undeclaredKeysIn(declared: Set<string>, objText: string): string[] {
  return topLevelKeys(objText).filter((key) => !declared.has(key));
}

const GUARDED_CALLS = [
  // concurrencyGuard(db, table, id, tenantId, expected) / concurrencyGuardById(db, table, id, expected)
  { name: 'concurrencyGuard', re: /\bconcurrencyGuard(?:ById)?\s*\(\s*(?:[\w$]+\.db|tx|db|client|trx)\s*,\s*([A-Za-z_$][\w$]*)/g, needTenantArg: true },
  // withConcurrencyGuard(() => db.update(table)… , label, expected) — overload 1
  { name: 'withConcurrencyGuard', re: /\bwithConcurrencyGuard\s*\(\s*\(\)\s*=>\s*[\w$]+\.update\(\s*([A-Za-z_$][\w$]*)/g, needTenantArg: false },
  // updatedAtMs(table, expected) — the predicate form
  { name: 'updatedAtMs', re: /\bupdatedAtMs\s*\(\s*([A-Za-z_$][\w$]*)\s*,/g, needTenantArg: false },
] as const;

interface Sweep {
  files: number;
  statements: number;
  guards: number;
  unresolved: string[];
  undeclaredKeys: string[];
  inertGuards: string[];
  ambiguous: string[];
}

async function sweep(): Promise<Sweep> {
  const tables = await loadTables();

  const out: Sweep = {
    files: 0, statements: 0, guards: 0,
    unresolved: [], undeclaredKeys: [], inertGuards: [], ambiguous: [],
  };

  const resolveTable = (name: string, modKey: string | null | undefined, where: string): { key: string; declared: Set<string> } | null => {
    if (modKey) {
      const declared = tables.get(modKey)?.get(name);
      return declared ? { key: modKey, declared } : null;
    }
    const hits: { key: string; declared: Set<string> }[] = [];
    for (const [key, per] of tables) {
      const declared = per.get(name);
      if (declared) hits.push({ key, declared });
    }
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      // The barrel cannot expose two bindings under one name, so a tie only means the
      // file's own import is ambiguous to *this* reader. Same shape -> safe to check.
      const distinct = new Set(hits.map((h) => [...h.declared].join(',')));
      if (distinct.size === 1) return hits[0]!;
      out.ambiguous.push(`${where}  "${name}" is exported by ${hits.map((h) => h.key).join(' and ')} with different columns — not checkable here`);
      return null;
    }
    return null;
  };

  const dirs = ['app', 'lib', 'scripts', 'components', 'drizzle', 'modules'];
  for (const sub of dirs) {
    let files: string[];
    try { files = walk(join(ROOT, sub)); } catch { continue; }
    for (const file of files) {
      const rel = file.slice(ROOT.length + 1);
      const raw = readFileSync(file, 'utf8');
      const src = blankComments(raw);
      out.files += 1;
      const imports = importSources(src);
      const lineAt = (offset: number) => raw.slice(0, offset).split('\n').length;

      for (const m of src.matchAll(/\.(insert|update)\(\s*(?:[\w$]+\.|db\.)?([A-Za-z0-9_]+)\s*\)/g)) {
        const kind = m[1]!;
        const table = m[2]!;
        const at = m.index ?? 0;
        const where = `${rel}:${lineAt(at)}`;
        const resolved = resolveTable(table, imports.get(table), where);
        if (!resolved) { out.unresolved.push(`${where}  ${kind}(${table}) — table not resolved to a schema export`); continue; }
        const opener = kind === 'insert' ? '.values' : '.set';
        const from = at + m[0].length;
        const call = src.indexOf(opener, from);
        if (call < 0 || call - from > 400) continue; // chained further away, or never written here
        const paren = matchBraced(src, src.indexOf('(', call + opener.length), '(', ')');
        if (!paren) continue;
        const brace = paren.text.indexOf('{');
        if (brace < 0) { out.unresolved.push(`${where}  ${kind}(${table}) ${opener}(...) is not an object literal`); continue; }
        const obj = matchBraced(paren.text, brace, '{', '}');
        if (!obj) continue;
        if (/\.\.\./.test(obj.text)) { out.unresolved.push(`${where}  ${kind}(${table}) ${opener}(...) is spread-built`); continue; }
        out.statements += 1;
        for (const key of undeclaredKeysIn(resolved.declared, obj.text)) {
          out.undeclaredKeys.push(
            `${rel}:${lineAt(at)}  ${kind}(${table}) [${resolved.key}] passes "${key}", which the table does not declare — Drizzle renders it as nothing`,
          );
        }
      }

      for (const call of GUARDED_CALLS) {
        call.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = call.re.exec(src))) {
          const at = m.index ?? 0;
          const table = m[1]!;
          const where = `${rel}:${lineAt(at)}`;
          const resolved = resolveTable(table, imports.get(table), where);
          if (!resolved) continue;
          out.guards += 1;
          // lib/api/concurrency.ts returns null for any table that does not declare
          // id + updatedAt; overload 1 returns null instead of a predicate.
          const missing = ['id', 'updatedAt'].filter((p) => !resolved.declared.has(p));
          if (missing.length) {
            out.inertGuards.push(
              `${where}  ${call.name}(${table}) [${resolved.key}]: the table declares no ${missing.join('/')} `
              + `— lib/api/concurrency.ts returns null, so the precondition is accepted and then ignored`,
            );
          }
        }
      }
    }
  }
  return out;
}

let result: Sweep = {
  files: 0, statements: 0, guards: 0,
  unresolved: [], undeclaredKeys: [], inertGuards: [], ambiguous: [],
};

describe('#3216 — no write may pass a key its table does not declare', () => {
  beforeAll(async () => {
    result = await sweep();
    // Reported, not asserted: these are the sites static analysis cannot see, so the
    // reader knows what the sweep did *not* check.
    // eslint-disable-next-line no-console
    console.log(`[3216 sweep] ${result.files} files · ${result.statements} write statements · ${result.guards} guard sites · ${result.unresolved.length} unresolved · ${result.ambiguous.length} ambiguous`);
  }, 120_000);

  it('every static .set()/.values() key in the tree is a declared column', () => {
    expect(result.undeclaredKeys, `undeclared write keys:\n${result.undeclaredKeys.join('\n')}`).toEqual([]);
  });

  it('the sweep is still looking at something (a real coverage floor, not a vacuous pass)', () => {
    // Measured 2026-10-24 over app/lib/scripts/components/drizzle/modules on `main`
    // at dc3555770: 1775 files read, 861 write statements checked, 98 guard sites
    // checked. The floor is deliberately below that so ordinary refactors do not trip
    // it, and far above zero so a sweep that went blind cannot pass.
    expect(result.files).toBeGreaterThan(1500);
    expect(result.statements).toBeGreaterThan(700);
    expect(result.guards).toBeGreaterThan(60);
  });

  it('no optimistic-concurrency guard is aimed at a table that cannot answer it', () => {
    expect(result.inertGuards, `inert guards:\n${result.inertGuards.join('\n')}`).toEqual([]);
  });

  it('the parser reads keys, not prose — docblock examples must not become findings', () => {
    // Three of the four findings the first version of this sweep reported were the
    // usage examples in `lib/api/concurrency.ts` and `lib/concurrency.ts`. A checker
    // that fires on prose gets ignored, so the blanking is load-bearing.
    const withProse = [
      '/**',
      ' * Example:',
      ' *   db.update(aiActivity).set({ accepted: true, updatedAt: ts })',
      ' */',
      'db.update(aiActivity).set({ accepted: true });',
    ].join('\n');
    const blanked = blankComments(withProse);
    const at = blanked.lastIndexOf('.set(');
    const paren = matchBraced(blanked, blanked.indexOf('(', at), '(', ')')!;
    const brace = paren.text.indexOf('{');
    const obj = matchBraced(paren.text, brace, '{', '}')!;
    expect(topLevelKeys(obj.text)).toEqual(['accepted']);
    expect(topLevelKeys(obj.text)).not.toContain('updatedAt');
  });

  it('the check bites: the exact shapes #3212 and #3214 shipped with are reported', async () => {
    const { aiActivity } = await import('@/drizzle/schema/ai');
    const { savedViews } = await import('@/drizzle/schema');
    const cols = (t: unknown) => new Set(Object.keys(
      (t as Record<symbol, Record<string, unknown>>)[Table.Symbol.Columns],
    ));

    // main's own writes, re-checked by the same predicate the sweep applies. The
    // argument is an object *body*, the way matchBraced hands it to the sweep.
    expect(undeclaredKeysIn(cols(aiActivity), ' accepted: true, updatedAt: new Date() ')).toEqual(['updatedAt']);
    expect(undeclaredKeysIn(cols(savedViews), ' deletedAt: now, deletedBy: user, updatedAt: now ')).toEqual(['deletedBy']);

    // …and the shape that is legal today is not flagged.
    expect(undeclaredKeysIn(cols(aiActivity), ' accepted: true ')).toEqual([]);
  });

  it('a phantom key really is invisible in the rendered SQL — that is why this needs a check at all', async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    // Never connected: .toSQL() renders lazily, and port 1 on the loopback is a fixture.
    const db = drizzle(new Pool({ connectionString: 'postgres://nucrm_fix:nucrm_fix@127.0.0.1:1/nucrm.test' }));
    const { aiActivity } = await import('@/drizzle/schema/ai');

    const honest = db.update(aiActivity).set({ accepted: true } as never).toSQL().sql;
    const phantom = db.update(aiActivity).set({ accepted: true, updatedAt: new Date() } as never).toSQL().sql;

    expect(honest).toContain('"accepted"');
    expect(phantom).toContain('"accepted"');
    // The #3214 defect: asking to write updated_at costs nothing and changes nothing.
    expect(phantom).not.toContain('updated_at');
  });
});
