import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #2633 — product_templates (DB) is the single source of truth for industry
 * templates. INDUSTRY_TEMPLATES is now seed-source-only (migration 0128 was
 * generated from it); any RUNTIME importer would silently ignore superadmin
 * edits, which is exactly the split-brain this issue is about. This guard
 * fails if app/, lib/ or components/ import the static map again.
 */

const ROOT = join(__dirname, '..', '..');
const SCAN_DIRS = ['app', 'lib', 'components'];
const SELF = join(ROOT, 'lib', 'modules', 'industry-templates.ts');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(entry)) yield p;
  }
}

describe('INDUSTRY_TEMPLATES import guard (#2633)', () => {
  it('no runtime file imports the deprecated static template map', () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      const abs = join(ROOT, dir);
      let exists = true;
      try { statSync(abs); } catch { exists = false; }
      if (!exists) continue;
      for (const file of walk(abs)) {
        if (file === SELF) continue;
        const src = readFileSync(file, 'utf8');
        if (/from\s+['"]@\/lib\/modules\/industry-templates(\.ts)?['"]/.test(src)
          || /import\(['"]@\/lib\/modules\/industry-templates['"]\)/.test(src)) {
          offenders.push(file.replace(ROOT, ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the static map is marked @deprecated', () => {
    const src = readFileSync(SELF, 'utf8');
    expect(src).toContain('@deprecated');
  });

  it('runtime template access goes through lib/templates', () => {
    const resolveSrc = readFileSync(join(ROOT, 'lib', 'templates', 'resolve.ts'), 'utf8');
    const applySrc = readFileSync(join(ROOT, 'lib', 'templates', 'apply-template.ts'), 'utf8');
    expect(resolveSrc).toContain('productTemplates');
    expect(applySrc).not.toContain('@/lib/modules/industry-templates');
  });
});
