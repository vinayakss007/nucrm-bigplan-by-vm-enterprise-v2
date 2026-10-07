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
 * Refresh counts after a legitimate reduction:
 *   node scripts/check-any-suppressions.mjs --update
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Every directory eslint actually lints. The old list stopped at app/lib/
// components/hooks/(a nonexistent workers), which left 37 suppressions in
// drizzle/, types/, tests/ and scripts/ outside the ratchet — a file could grow
// there unchecked while the guard reported "1 suppression".
const ROOTS = ['app', 'components', 'drizzle', 'hooks', 'lib', 'scripts', 'tests', 'types'];
const BASELINE_FILE = 'scripts/any-suppression-baseline.json';
const UPDATE = process.argv.includes('--update');
// Matches file/block `eslint-disable` and inline `eslint-disable-next-line` /
// `eslint-disable-line` comments that name the no-explicit-any rule.
const RE = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-any/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : {};

const counts = {};
for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    const n = (readFileSync(file, 'utf8').match(RE) || []).length;
    if (n > 0) counts[file] = n;
  }
}

// Root-level sources — worker.ts and the Sentry configs — are linted like any
// other file but sit outside every ROOTS entry, so 14 suppressions were
// invisible to the ratchet until now.
for (const name of readdirSync('.')) {
  if (!/\.(ts|tsx)$/.test(name) || name === 'next-env.d.ts') continue;
  if (/\.(test|spec)\.(ts|tsx)$/.test(name) || /\.stories\.tsx$/.test(name)) continue;
  const n = (readFileSync(name, 'utf8').match(RE) || []).length;
  if (n > 0) counts[name] = n;
}

if (UPDATE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`[check-any-suppressions] baseline updated: ${total} suppressions across ${Object.keys(counts).length} files`);
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
