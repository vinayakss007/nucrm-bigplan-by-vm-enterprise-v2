/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #1842 — a skip link with no target is decoration.
 *
 * `components/ui/skip-link.tsx` renders in the root layout, so "Skip to main
 * content" is the first thing a keyboard or screen-reader user meets on every
 * page in the app. It navigates to `#main-content` (`:14`, the default
 * `targetId`). Three of the six `<main>` landmarks in the tree answered to
 * something else or to nothing:
 *
 *   - `app/portal/layout.tsx` — a bare `<main>`, so a portal visitor tabbed
 *     through the whole header and sidebar before reaching content;
 *   - the public offer and sign routes (`app/p/offers/...` and `app/p/sign/...`) —
 *     the two pages an external buyer opens cold from an email, with no prior
 *     page, no session and no secondary navigation to fall back on;
 *   - `app/(marketing)/layout.tsx` — `id="main"`, which nothing links to and
 *     which no stylesheet or script referenced (`grep '#main'` over `app/`,
 *     `components/` and `*.css` returned only the declaration), so the whole
 *     marketing site wasted it too.
 *
 * The invariant this pins is one line long: **the skip link's target exists on
 * every page that renders the skip link.** The root layout is the only place
 * `SkipLink` is mounted, and every `<main>` in the tree is a page rendered
 * inside it, so every `<main>` must carry `id="main-content"` — and
 * `tabIndex={-1}`, because a `<main>` that is not focusable leaves focus at the
 * top of the document in browsers that do not move the sequential focus point
 * to a fragment target.
 *
 * This is a source-level check on purpose: rendering the marketing site and the
 * portal in one test would need two session establishments, two builds and a
 * running server, and the property under test is a literal in a file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (name.endsWith('.tsx')) out.push(abs);
  }
  return out;
}

const tsxFiles = [
  ...walk(join(ROOT, 'app')),
  ...walk(join(ROOT, 'components')),
  ...walk(join(ROOT, 'lib')),
];

/** Every `<main …>` opening tag in the tree, with the file that declares it. */
const landmarks = tsxFiles.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/<main\b[^>]*>/g)].map((m) => ({
    file: file.slice(ROOT.length + 1).split('\\').join('/'),
    tag: m[0],
  })),
);

describe('the skip link lands somewhere (#1842)', () => {
  it('renders the link from the root layout, which is what makes every page carry it', () => {
    const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8');
    expect(layout).toMatch(/import \{ SkipLink \} from '@\/components\/ui\/skip-link'/);
    expect(layout).toContain('<SkipLink');
  });

  it('the component targets `main-content` by default', () => {
    const link = readFileSync(join(ROOT, 'components/ui/skip-link.tsx'), 'utf8');
    expect(link).toMatch(/targetId = 'main-content'/);
    expect(link).toMatch(/href=\{`#\$\{targetId\}`\}/);
  });

  it('found the landmarks it is asserting over, so a rename cannot make this vacuous', () => {
    expect(landmarks.length).toBeGreaterThanOrEqual(6);
    const files = new Set(landmarks.map((l) => l.file));
    // The four that were broken, named so deleting the id fails here by file.
    expect(files).toContain('app/portal/layout.tsx');
    expect(files).toContain('app/(marketing)/layout.tsx');
    expect(files).toContain(['app', 'p', 'offers', '[publicToken]', 'page.tsx'].join('/'));
    expect(files).toContain(['app', 'p', 'sign', '[token]', 'page.tsx'].join('/'));
  });

  it('every `<main>` is the skip link target', () => {
    for (const { file, tag } of landmarks) {
      expect(tag, `${file}: <main> must carry id="main-content"`).toContain('id="main-content"');
    }
  });

  it('every `<main>` can receive focus after the fragment jump', () => {
    for (const { file, tag } of landmarks) {
      expect(tag, `${file}: <main> must be programmatically focusable`).toMatch(/tabIndex=\{-1\}/);
    }
  });

  it('no landmark answers to a second, unlinked id', () => {
    for (const { file, tag } of landmarks) {
      expect(tag, `${file}: a second id on the landmark cannot be the skip target`)
        .not.toMatch(/\bid="(?!main-content")/);
    }
  });

  it('nothing still points at the old `#main` target', () => {
    for (const file of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]) {
      const body = readFileSync(file, 'utf8');
      expect(body, `${file} still references #main`).not.toMatch(/href="#main"|['"]#main['"]/);
    }
  });
});
