/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * no-explicit-any suppression ratchet (#1268 / #1269 / #1341).
 *
 * Same strategy as check-file-size.mjs: stop the pile-up without a mass
 * retype.
 *  - A NEW file containing any `eslint-disable*` comment for
 *    `@typescript-eslint/no-explicit-any` fails CI (write it typed instead).
 *  - A grandfathered file whose suppression count GROWS past its recorded
 *    baseline fails CI.
 *  - A file that SHRANK prints a hint to refresh its baseline entry.
 *
 * The ratchet's scope is exactly what eslint lints, no narrower — closing that
 * gap is what #1268 was still open for. ROOTS grew to list `tests` on the
 * theory that the suppressions there were covered, but `walk()` kept dropping
 * every `*.test.ts`/`*.test.tsx` it met, so 438 of the tree's 464 suppressions
 * across 134 files sat outside the ratchet: a test file could add as many `any`s
 * as it liked while the guard printed `OK — 26 suppressions in 11 files`. Those
 * comments are not decorative either — `@typescript-eslint/no-explicit-any` is
 * `error` repo-wide, and the `tests/**` override in eslint.config.mjs relaxes
 * `no-require-imports`, `ban-ts-comment` and `no-unused-expressions` only, so
 * deleting one without typing the code fails `npm run lint`.
 *
 * Refresh counts after a legitimate reduction:
 *   node scripts/check-any-suppressions.mjs --update
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'components', 'drizzle', 'hooks', 'lib', 'scripts', 'tests', 'types'];
const BASELINE_FILE = 'scripts/any-suppression-baseline.json';
// Matches file/block `eslint-disable` and inline `eslint-disable-next-line` /
// `eslint-disable-line` comments that name the no-explicit-any rule.
const RE = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-any/g;

// The two shapes of `ignores` in eslint.config.mjs: bare directory names, and
// paths that only mean something from the repository root.
const IGNORED_NAMES = new Set([
  'node_modules', '.next', '.next-build', 'out', 'coverage', 'storybook-static',
  'playwright-report', 'test-results', 'public', 'archive',
]);
const IGNORED_PATHS = new Set(['drizzle/migrations', 'tests/load']);

/**
 * Would `npm run lint` read this path? Answered from the flat config's ignores
 * instead of a hand-picked extension rule, so the ratchet and the lint cannot
 * disagree again about which files carry weight.
 */
export function isLintedSource(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!/\.(ts|tsx)$/.test(name)) return false;
  return name !== 'next-env.d.ts' && !/\.stories\.tsx$/.test(name);
}

export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name.startsWith('.') || IGNORED_NAMES.has(name) || IGNORED_PATHS.has(p)) continue;
      out.push(...walk(p));
    } else if (isLintedSource(p)) {
      out.push(p);
    }
  }
  return out;
}

/** Suppression count per linted source, over ROOTS plus the root-level files. */
export function collect() {
  const counts = {};
  const count = (file) => (readFileSync(file, 'utf8').match(RE) || []).length;
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const file of walk(root)) {
      const n = count(file);
      if (n > 0) counts[file] = n;
    }
  }
  // Root-level sources — the Sentry configs and worker entrypoints — are linted
  // like any other file but sit outside every ROOTS entry.
  for (const entry of readdirSync('.', { withFileTypes: true })) {
    if (!entry.isFile() || !isLintedSource(entry.name)) continue;
    const n = count(entry.name);
    if (n > 0) counts[entry.name] = n;
  }
  return counts;
}

/** The CLI. Exported helpers above are what the #1341/#1268 test imports. */
function main() {
  const UPDATE = process.argv.includes('--update');
  const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : {};

  const counts = collect();

  if (UPDATE) {
    writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
    const updated = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`[check-any-suppressions] baseline updated: ${updated} suppressions across ${Object.keys(counts).length} files`);
    process.exit(0);
  }

  const newOffenders = [];
  const grownOffenders = [];
  const shrunk = [];

  for (const [file, n] of Object.entries(counts)) {
    const base = baseline[file];
    if (base === undefined) newOffenders.push({ file, n });
    else if (n > base) grownOffenders.push({ file, n, base });
    else if (n < base) shrunk.push({ file, n, base });
  }

  if (shrunk.length > 0) {
    console.log(
      `\n\u001b[36mℹ ${shrunk.length} file(s) shed no-explicit-any suppressions — run \`node scripts/check-any-suppressions.mjs --update\` to ratchet the baseline down:\u001b[0m\n` +
        shrunk.map((s) => `    - ${s.file} (${s.base} -> ${s.n})`).join('\n'),
    );
  }

  let failed = false;

  if (newOffenders.length > 0) {
    failed = true;
    console.error(
      `\n\u001b[31m✖ New file(s) suppress @typescript-eslint/no-explicit-any (#1268/#1269/#1341):\u001b[0m\n` +
        newOffenders.map((o) => `    - ${o.file} (${o.n})`).join('\n') +
        `\n\n  Type the code instead. If a suppression is truly unavoidable,\n` +
        `  add the file to ${BASELINE_FILE} with a justification in review.\n`,
    );
  }

  if (grownOffenders.length > 0) {
    failed = true;
    console.error(
      `\n\u001b[31m✖ Grandfathered file(s) grew past their suppression baseline (#1268/#1269/#1341):\u001b[0m\n` +
        grownOffenders.map((o) => `    - ${o.file} (${o.n} > baseline ${o.base})`).join('\n') +
        `\n\n  These files are supposed to shrink, not grow.\n`,
    );
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!failed) {
    console.log(`[check-any-suppressions] OK — ${total} suppressions in ${Object.keys(counts).length} files, none grew.`);
    if (shrunk.length === 0) console.log('  (baseline is current)');
  } else {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
