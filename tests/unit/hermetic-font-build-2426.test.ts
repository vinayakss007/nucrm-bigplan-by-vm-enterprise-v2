/**
 * #2426 — the production build must not depend on a third-party font endpoint.
 *
 * `app/layout.tsx` used `next/font/google`, which downloads the woff2 files at
 * COMPILE time. CI's Build job then failed on `d17ab596` with
 *   Turbopack build failed with 12 errors:
 *   Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
 * while all six other jobs passed, and re-running the identical SHA passed —
 * i.e. a release build could go red because fonts.gstatic.com was briefly
 * unreachable, with no code at fault. `Dockerfile:59` runs the same
 * `npm run build`, so shipping had the same hidden dependency.
 *
 * The fonts are vendored under `app/fonts/` now (latin subset, static weight
 * instances, byte-for-byte what Google served). These tests pin the three ways
 * that could silently regress:
 *   1. someone re-introduces a build-time fetch (`next/font/google`),
 *   2. a font binary goes missing or is truncated (build fails, or renders at
 *      the fallback face — a customer-visible typography change),
 *   3. the CSS contract drifts (the two `--font-*` variables are consumed by
 *      `app/globals.css` and `tailwind.config.ts`; renaming either silently
 *      drops the whole app to system fonts).
 * `.gitignore` is checked too: an ignored binary passes every local test and
 * only fails on a fresh CI checkout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const LAYOUT = join(ROOT, 'app/layout.tsx');
const layoutSrc = readFileSync(LAYOUT, 'utf-8');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, dir));
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(ROOT, dir, e);
    const st = statSync(p);
    if (st.isDirectory()) sourceFiles(`${dir}/${e}`, acc);
    else if (/\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

const appFiles = [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')];

describe('no build-time font download', () => {
  it('scans a source tree that actually has files in it', () => {
    expect(appFiles.length).toBeGreaterThan(500);
  });

  it('nothing imports next/font (google) anywhere in app, lib or components', () => {
    const offenders = appFiles.filter((f) =>
      /from ['"]next\/font\/google['"]|require\(['"]next\/font\/google['"]\)/.test(readFileSync(f, 'utf-8'))
    );
    expect(offenders, `${offenders.join(', ')} would make the build fetch fonts at compile time`).toEqual([]);
  });

  it('the layout uses next/font/local', () => {
    expect(layoutSrc).toMatch(/from ['"]next\/font\/local['"]/);
  });
});

describe('the vendored font files are present and real', () => {
  const declared = [...layoutSrc.matchAll(/path:\s*'\.\/fonts\/([^']+)'/g)].map((m) => m[1]);

  it('declares exactly the eight weights the app used to download', () => {
    expect(declared.sort()).toEqual(
      [
        'inter-latin-400.woff2',
        'inter-latin-500.woff2',
        'inter-latin-600.woff2',
        'inter-latin-700.woff2',
        'inter-latin-800.woff2',
        'inter-latin-900.woff2',
        'jetbrains-mono-latin-400.woff2',
        'jetbrains-mono-latin-500.woff2',
      ].sort()
    );
  });

  it('every declared file exists, is a woff2, and is a plausible size', () => {
    for (const name of declared) {
      const p = join(ROOT, 'app/fonts', name);
      expect(existsSync(p), `${p} is referenced by app/layout.tsx but missing`).toBe(true);
      const bytes = readFileSync(p);
      expect(bytes.subarray(0, 4).toString('latin1'), `${name} is not a woff2`).toBe('wOF2');
      // A latin static instance of either family is 20-25 KB; a truncated or
      // LFS-pointer stub would be a few hundred bytes and still build.
      expect(bytes.length, `${name} looks truncated (${bytes.length} bytes)`).toBeGreaterThan(10_000);
    }
  });

  it('weights and styles are declared explicitly, not inferred', () => {
    const entries = [...layoutSrc.matchAll(/\{\s*path:\s*'[^']+',\s*weight:\s*'(\d+)',\s*style:\s*'(\w+)'\s*\}/g)];
    expect(entries.length).toBe(declared.length);
    for (const [, weight, style] of entries) {
      expect(Number(weight)).toBeGreaterThanOrEqual(100);
      expect(style).toBe('normal');
    }
  });

  it('no .gitignore rule can drop them from a fresh checkout', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    for (const name of ['app/fonts/inter-latin-400.woff2', 'app/fonts/jetbrains-mono-latin-400.woff2']) {
      for (const rule of ignore) {
        const bare = rule.replace(/^\/+/, '');
        if (!bare) continue;
        const hits =
          bare === name ||
          bare === `${name.split('/')[0]}/fonts` ||
          bare === `${name.split('/')[0]}/fonts/${name.split('/')[2]}` ||
          (bare.startsWith('*.') && name.endsWith(bare.slice(1))) ||
          (bare.endsWith('/') && name.startsWith(bare));
        expect(hits, `.gitignore rule ${rule} would ignore ${name}`).toBe(false);
      }
    }
  });
});

describe('the CSS contract is unchanged', () => {
  // Both consumers must keep resolving; if a variable is renamed in one place
  // only, the app silently falls back to system-ui/monospace everywhere.
  it('the layout still defines the two variables', () => {
    expect(layoutSrc).toContain("'--font-inter'");
    expect(layoutSrc).toContain("'--font-jetbrains-mono'");
  });

  it('globals.css and tailwind.config still consume them', () => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf-8');
    expect(css).toContain('var(--font-inter)');
    expect(css).toContain('var(--font-jetbrains-mono)');
    const tw = readFileSync(join(ROOT, 'tailwind.config.ts'), 'utf-8');
    expect(tw).toContain("'var(--font-inter)'");
    expect(tw).toContain("'var(--font-jetbrains-mono)'");
  });

  it('display is still swap, so first paint is not blocked on the local files', () => {
    const displays = [...layoutSrc.matchAll(/display:\s*'(\w+)'/g)].map((m) => m[1]);
    expect(displays.length).toBe(2);
    expect(displays.every((d) => d === 'swap')).toBe(true);
  });
});
