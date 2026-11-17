/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3312 ask 1 — the portal RLS guard must follow imports, not stop at the route
 * file. `buildTargets()` names the anonymous routes; a route that hands its
 * payload to `lib/...` is only as safe as that library's own reads. Measured on
 * this tree, the named walk saw 122 files and 200 statements; following `@/`
 * and relative imports reaches 297 files and 539 statements, of which 200 reads
 * across 38 lib/ files were INVISIBLE before this change.
 *
 * What is under test:
 *   - importSpecifiers / resolveImportFile / deriveTargets in the guard
 *   - the real derived walk, its re-pinned floors, and the counted lib/ deferral
 *   - a negative control: a newly reachable lib/ file with an unbound read is
 *     reported when the deferral ceiling is exceeded, rather than waved through
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildTargets,
  deriveTargets,
  importSpecifiers,
  LIB_IMPORT_DEFERRAL,
  loadTenantTables,
  MIN_DERIVED_FILES,
  MIN_DERIVED_READS,
  resolveImportFile,
  run,
  SCOPE_DEFERRALS,
  verifyDeferral,
  type TenantTable,
  type Violation,
} from '../../scripts/check-portal-rls-context.mts';

const ROOT = join(import.meta.dirname!, '..', '..');

let repoTables: Map<string, TenantTable>;
beforeAll(async () => {
  repoTables = await loadTenantTables(ROOT);
}, 30_000);

describe('#3312 the import resolver', () => {
  it('reads every import form, including type-only and dynamic', () => {
    const src = [
      "import { a } from '@/lib/a';",
      "import type { B } from '../b';",
      "export { c } from './c';",
      "import '@/lib/side-effect';",
      "const d = await import('@/lib/d');",
      "const notAnImport = 'from \\'fake\\'';",
    ].join('\n');
    const specs = importSpecifiers(src);
    expect(specs).toContain('@/lib/a');
    expect(specs).toContain('../b');
    expect(specs).toContain('./c');
    expect(specs).toContain('@/lib/side-effect');
    expect(specs).toContain('@/lib/d');
  });

  it('resolves @/ aliases, relative paths, extensions and index files', () => {
    const files = new Set([
      '/r/lib/a.ts',
      '/r/lib/b/index.ts',
      '/r/app/api/x/route.ts',
      '/r/lib/c.mts',
    ]);
    const exists = (p: string) => files.has(p);
    expect(resolveImportFile('@/lib/a', '/r/app/api/x/route.ts', '/r', exists)).toBe('/r/lib/a.ts');
    expect(resolveImportFile('@/lib/b', '/r/app/api/x/route.ts', '/r', exists)).toBe('/r/lib/b/index.ts');
    expect(resolveImportFile('../../../lib/c.mts', '/r/app/api/x/route.ts', '/r', exists)).toBe('/r/lib/c.mts');
    expect(resolveImportFile('drizzle-orm', '/r/lib/a.ts', '/r', exists)).toBeNull();
    expect(resolveImportFile('@/lib/nope', '/r/lib/a.ts', '/r', exists)).toBeNull();
  });

  it('follows imports transitively from a fixture, visiting each file once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rls-imports-'));
    try {
      mkdirSync(join(dir, 'lib'), { recursive: true });
      mkdirSync(join(dir, 'app/api/public'), { recursive: true });
      // A minimal proxy makes publicScopeDirs seed the walk with this one
      // anonymous route, so the resolver is exercised on a tree we control.
      writeFileSync(join(dir, 'proxy.ts'), "export const PUBLIC_PATHS = ['/api/public'];\n");
      writeFileSync(join(dir, 'app/api/public/route.ts'), "import { leaf } from '@/lib/leaf';\nexport const GET = leaf;\n");
      writeFileSync(join(dir, 'lib/leaf.ts'), "import { deep } from './deep';\nexport const leaf = deep;\n");
      writeFileSync(join(dir, 'lib/deep.ts'), 'export const deep = 1;\n');
      writeFileSync(join(dir, 'lib/unreachable.ts'), 'export const nope = 1;\n');

      // leaf/deep are reached through imports; unreachable.ts is not.
      const targets = await deriveTargets(dir);
      expect(targets).toContain('lib/leaf.ts');
      expect(targets).toContain('lib/deep.ts');
      expect(targets).not.toContain('lib/unreachable.ts');
      expect(new Set(targets).size).toBe(targets.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#3312 the real derived walk', () => {
  it('reaches far more than the named route surface', async () => {
    const base = buildTargets(ROOT);
    const derived = await deriveTargets(ROOT);
    expect(derived.length).toBeGreaterThan(base.length + 100);
    // Files that only a transitive import from an anonymous route can reach.
    for (const rel of ['lib/lead-warming/engine.ts', 'lib/ai/gateway.ts', 'lib/webhooks.ts']) {
      expect(derived, rel).toContain(rel);
      expect(base, rel).not.toContain(rel);
    }
  });

  it('walks the re-pinned floor and holds 200 newly visible reads in the counted deferral', async () => {
    const derived = await deriveTargets(ROOT);
    const res = await run(derived, ROOT, {
      tables: repoTables,
      deferrals: [...SCOPE_DEFERRALS, LIB_IMPORT_DEFERRAL],
    });
    expect(res.files).toBeGreaterThanOrEqual(MIN_DERIVED_FILES);
    expect(res.reads).toBeGreaterThanOrEqual(MIN_DERIVED_READS);
    expect(res.violations).toEqual([]);
    const lib = res.deferred.find((d) => d.dir === LIB_IMPORT_DEFERRAL.dir);
    expect(lib).toMatchObject({ deferredTo: '#3312', maxFindings: LIB_IMPORT_DEFERRAL.maxFindings });
    expect(lib!.count).toBeGreaterThanOrEqual(200);
    expect(lib!.count).toBeLessThanOrEqual(LIB_IMPORT_DEFERRAL.maxFindings);
  }, 60_000);

  it('pins the deferral to the issue that owns the binding work, with a reviewable reason', () => {
    expect(verifyDeferral(LIB_IMPORT_DEFERRAL)).toBeNull();
    expect(LIB_IMPORT_DEFERRAL.deferredTo).toBe('#3312');
    expect(LIB_IMPORT_DEFERRAL.why).toContain('#3312');
    expect(LIB_IMPORT_DEFERRAL.maxFindings).toBe(200);
  });

  it('fails closed when a new unbound read joins the deferred surface', async () => {
    const derived = await deriveTargets(ROOT);
    const tight = { ...LIB_IMPORT_DEFERRAL, maxFindings: 1 };
    const res = await run(derived, ROOT, {
      tables: repoTables,
      deferrals: [...SCOPE_DEFERRALS, tight],
    });
    const problem = res.violations.find((v: Violation) => /pinned at 1 contextless read/.test(v.problem));
    expect(problem?.problem).toMatch(/pinned at 1 contextless read/);
  }, 60_000);
});
