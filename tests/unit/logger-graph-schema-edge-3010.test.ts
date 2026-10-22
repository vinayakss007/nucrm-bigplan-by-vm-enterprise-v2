/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #3010's two structural causes, screened so neither can come back as a side effect.
 *
 * (1) `lib/logger.ts` is imported by almost every server module, so whatever it imports
 *     statically is in the graph of every test that reaches a logger. When the #216
 *     silent-catch sweep (#2986) gave `logger` a static import of `@/lib/errors-server`,
 *     and that module kept a static import of `@/drizzle/schema/support`, the schema's
 *     module-scope calls to the real `sql` and `relations` landed in ~20 suites that mock
 *     `drizzle-orm` narrowly — `No "sql" export is defined on the "drizzle-orm" mock`, 150
 *     tests, none of them about logging.
 * (2) A test that pins "this was red at base" by reading `origin/main` at runtime is true
 *     only until its own PR merges, and a pinned SHA does not survive CI's depth-1
 *     checkout either. #2957 shipped exactly such a case and it has been failing on main
 *     ever since.
 *
 * Both screens are graph reads over the tracked tree, not behaviour: nothing here fails
 * for a reason a passing product build could have.
 *
 * RED AT BASE — measured at `ffef1659` (main) with this file as committed and every other
 * file at main: 3 of these 6 cases fail (vitest prints "3 failed | 3 passed (6)") — the
 * logger walk, the sink-shape pin, and the moving-ref scan, which finds #2957's
 * `git show origin/main:` case. The other 3 pass at base and are the controls that must
 * keep passing: the walk is not vacuous, `@/…` resolution reaches real
 * files, and `logger` still logs.
 */

const ROOT = join(import.meta.dirname!, '..', '..');

/** How vitest resolves a `@/…` specifier: tsconfig paths → repo root, then these. */
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'];

function resolveLocal(spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const base = join(ROOT, spec.slice(2));
  for (const ext of EXTENSIONS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** `import x from '…'`, `import '…'`, and `export … from '…'` — all static edges. */
const STATIC_EDGE_RE =
  /^\s*(?:import|export)\b(?:[^;'"]*?from\s*)?['"]([^'"]+)['"]/gm;

type Hit = { chain: string[]; spec: string };

/** Every `@/drizzle/schema*` module reachable from `seed` through static imports only. */
function schemaEdges(seed: string): Hit[] {
  const seen = new Set<string>();
  const hits: Hit[] = [];
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const m of source.matchAll(STATIC_EDGE_RE)) {
      const spec = m[1];
      if (spec.startsWith('@/drizzle/schema')) {
        hits.push({ chain: [...chain, file.replace(`${ROOT}/`, '')], spec });
      }
      const target = resolveLocal(spec);
      if (target) walk(target, [...chain, file.replace(`${ROOT}/`, '')]);
    }
  };
  walk(join(ROOT, seed), []);
  return hits;
}

function testFiles(): string[] {
  const out: string[] = [];
  const dir = (d: string) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) dir(p);
      else if (/\.(test|spec)\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  };
  dir('tests');
  return out;
}

describe('the module graph a logger import drags in (#3010)', () => {
  it('keeps drizzle/schema out of lib/logger.ts’s static graph', () => {
    const hits = schemaEdges('lib/logger.ts');
    const chains = hits.map((h) => `${h.chain.join(' → ')} → ${h.spec}`);
    expect(chains, `logger pulls the schema into every test that logs:\n${chains.join('\n')}`).toEqual([]);
  });

  it('still sees the edge when a module legitimately imports the schema — the screen is not vacuous', () => {
    // `lib/audit.ts` writes its row with a static table import and imports `logger`
    // itself, so the walk must find the schema on that graph. If this ever reports zero,
    // the walk has stopped matching and the case above proves nothing.
    const hits = schemaEdges('lib/audit.ts');
    expect(hits.length, 'the walk reached no schema module from a file that imports one').toBeGreaterThan(0);
    expect(hits.map((h) => h.spec)).toContain('@/drizzle/schema');
  });

  it('keeps the error sink pointed at the table it always wrote', () => {
    // The fix is about the edge, not the write: logError must still insert into
    // errorLogs, now loaded beside the driver it is written through.
    const src = readFileSync(join(ROOT, 'lib/errors-server.ts'), 'utf8');
    expect(src).toMatch(/await import\('@\/drizzle\/schema\/support'\)/);
    expect(src).toMatch(/await db\.insert\(errorLogs\)\.values\(/);
    expect(src, 'the schema import went back to module scope').not.toMatch(
      /^import \{[^}]*errorLogs[^}]*\} from '@\/drizzle\/schema\/support';/m,
    );
  });

  it('leaves logger logging', () => {
    const src = readFileSync(join(ROOT, 'lib/logger.ts'), 'utf8');
    expect(src).toMatch(/export (?:const |function )logger/);
    expect(src, 'the sweep’s routing was dropped instead of deferred').toMatch(/logError/);
  });
});

describe('the refs a suite is allowed to read (#3010)', () => {
  it('no suite pins a claim about base against a branch ref it will invalidate by merging', () => {
    const offenders = testFiles()
      .filter((f) => /spawnSync\(\s*'git',\s*\[[^\]]*origin\/(main|master|HEAD)/s.test(readFileSync(join(ROOT, f), 'utf8')))
      .sort();
    expect(offenders, 'a `git show origin/main:…` assertion is false from the moment its own slice merges').toEqual([]);
  });

  it('resolves a `@/…` specifier to the tracked file the runner would load', () => {
    // Every case above reads the tree through resolveLocal; if it silently returned null
    // the graph walk would be empty for the wrong reason.
    expect(resolveLocal('@/lib/logger.ts')?.endsWith('lib/logger.ts')).toBe(true);
    expect(resolveLocal('@/drizzle/db')).toBe(join(ROOT, 'drizzle/db.ts'));
    expect(resolveLocal('@/drizzle/schema')).toBe(join(ROOT, 'drizzle/schema/index.ts'));
    expect(resolveLocal('react-hot-toast'), 'bare specifiers are not ours to walk').toBeNull();
  });
});
