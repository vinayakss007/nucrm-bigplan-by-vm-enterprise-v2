/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Route-boundary coverage guard (#1840 / #654).
 *
 * Next.js error.tsx / loading.tsx boundaries CASCADE: a boundary at a parent
 * route segment covers every descendant page. So a page is "covered" if it has
 * its own boundary OR any ancestor segment (up to app/) provides one.
 *
 * This guard fails when any page.tsx has NO error.tsx (and, as a warning, no
 * loading.tsx) anywhere on its ancestor chain — i.e. a render throw would have
 * no boundary at all. With app/error.tsx + app/loading.tsx present, every route
 * is covered; the guard prevents someone from deleting a root/segment boundary
 * and silently reopening the gap.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const APP = 'app';

function findPages(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...findPages(p));
    else if (name === 'page.tsx' || name === 'page.jsx') out.push(p);
  }
  return out;
}

// Walk from the page's directory up to (and including) app/, checking for a
// boundary file at each level.
function hasAncestorBoundary(pageFile, boundary) {
  let dir = dirname(pageFile);
  while (true) {
    if (existsSync(join(dir, boundary))) return true;
    if (dir === APP) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

const pages = findPages(APP);
const missingError = [];
const missingLoading = [];

for (const page of pages) {
  if (!hasAncestorBoundary(page, 'error.tsx')) missingError.push(page);
  if (!hasAncestorBoundary(page, 'loading.tsx')) missingLoading.push(page);
}

if (missingLoading.length > 0) {
  console.warn(
    `\n\u001b[33m⚠ ${missingLoading.length} page(s) have no loading.tsx on their ancestor chain:\u001b[0m\n` +
      missingLoading.map((f) => `    - ${f}`).join('\n') +
      '\n  (non-fatal — navigations to these pages show no loading state)\n',
  );
}

if (missingError.length > 0) {
  console.error(
    '\n\u001b[31m✖ Route-boundary guard failed (#1840).\u001b[0m\n' +
      '\n  The following pages have NO error.tsx anywhere on their ancestor chain,\n' +
      '  so an unhandled render throw has no boundary:\n\n' +
      missingError.map((f) => `    - ${f}`).join('\n') +
      '\n\n  Fix: add an error.tsx at the page directory or a shared parent segment\n' +
      '  (app/error.tsx covers everything as the last resort).\n',
  );
  process.exit(1);
}

console.log(
  `[check-route-boundaries] OK — ${pages.length} pages, all covered by an error boundary` +
    (missingLoading.length ? ` (${missingLoading.length} without a loading state — see warning).` : '.'),
);
