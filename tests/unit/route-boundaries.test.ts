import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * Every page must sit under a Suspense boundary (`loading.tsx`) and an error
 * boundary (`error.tsx`).
 *
 * Both cascade in the App Router: a boundary at a segment covers that segment and
 * every descendant that does not define its own. So coverage is "does this page
 * or any ancestor up to app/ provide one", not "does this directory contain one".
 * Counting per-directory is what produced the "126 pages missing loading.tsx"
 * figure; the fix is a boundary at each segment root, not ~150 near-identical
 * files.
 */

const APP_DIR = path.join(process.cwd(), 'app');

function findPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route handlers live under app/api and render no UI.
      if (path.relative(APP_DIR, full).split(path.sep)[0] === 'api') continue;
      findPages(full, out);
    } else if (entry === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

/** Walk from the page's directory up to app/, looking for `file`. */
function coveredBy(pagePath: string, file: string): boolean {
  let dir = path.dirname(pagePath);
  for (;;) {
    if (existsSync(path.join(dir, file))) return true;
    if (path.resolve(dir) === path.resolve(APP_DIR)) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

const pages = findPages(APP_DIR);

describe('route boundaries', () => {
  it('finds the app router pages', () => {
    expect(pages.length).toBeGreaterThan(100);
  });

  it('every page is covered by an error boundary', () => {
    const uncovered = pages
      .filter((p) => !coveredBy(p, 'error.tsx'))
      .map((p) => path.relative(process.cwd(), p));
    expect(uncovered).toEqual([]);
  });

  it('every page is covered by a loading boundary', () => {
    const uncovered = pages
      .filter((p) => !coveredBy(p, 'loading.tsx'))
      .map((p) => path.relative(process.cwd(), p));
    expect(uncovered).toEqual([]);
  });

  // global-error.tsx is the only thing that catches a throw in the root layout;
  // a normal error.tsx cannot, because it renders inside that layout.
  it('has a global-error boundary for root layout failures', () => {
    expect(existsSync(path.join(APP_DIR, 'global-error.tsx'))).toBe(true);
  });

  /**
   * `useSearchParams()` suspends. Used outside a Suspense boundary it forces the
   * entire route out of prerendering into client-side rendering, so the page ships
   * with no server-rendered HTML.
   *
   * A page-level `loading.tsx` does not help: it wraps the segment's children, not
   * the page component's own render. The boundary has to be inside the file.
   */
  it('pages calling useSearchParams wrap it in a Suspense boundary', async () => {
    const { readFileSync } = await import('fs');
    const offenders: string[] = [];

    for (const p of pages) {
      const src = readFileSync(p, 'utf8');
      if (!src.includes('useSearchParams')) continue;
      if (!src.includes('Suspense')) offenders.push(path.relative(process.cwd(), p));
    }

    expect(offenders).toEqual([]);
  });
});
