/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * File-size ratchet (#1843 / #422).
 *
 * Goal: stop tech-debt growth without a risky mass-refactor.
 *  - Any NEW file (not in the baseline) over MAX_LINES fails CI.
 *  - Any grandfathered file that GROWS past its recorded baseline fails CI.
 *  - A grandfathered file that SHRANK to <= MAX_LINES prints a hint to remove
 *    its baseline entry (ratchet down).
 *
 * As large files get refactored below 500 lines, delete their entries from
 * scripts/file-size-baseline.json so the ceiling tightens over time.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_LINES = 500;
const ROOTS = ['app', 'lib', 'components'];
const baseline = JSON.parse(readFileSync('scripts/file-size-baseline.json', 'utf8'));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function lineCount(file) {
  const src = readFileSync(file, 'utf8');
  // match `wc -l` semantics (count newlines)
  let n = 0;
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

const files = ROOTS.flatMap(walk);
const newOffenders = [];
const grownOffenders = [];
const shrunk = [];

for (const file of files) {
  const lines = lineCount(file);
  const base = baseline[file];
  if (base === undefined) {
    if (lines > MAX_LINES) newOffenders.push({ file, lines });
  } else {
    if (lines > base) grownOffenders.push({ file, lines, base });
    else if (lines <= MAX_LINES) shrunk.push({ file, lines });
  }
}

if (shrunk.length > 0) {
  console.log(
    `\n\u001b[36mℹ ${shrunk.length} grandfathered file(s) are now ≤ ${MAX_LINES} lines — remove them from the baseline to tighten the ratchet:\u001b[0m\n` +
      shrunk.map((s) => `    - ${s.file} (${s.lines})`).join('\n'),
  );
}

let failed = false;

if (newOffenders.length > 0) {
  failed = true;
  console.error(
    `\n\u001b[31m✖ New file(s) exceed ${MAX_LINES} lines (#1843/#422):\u001b[0m\n` +
      newOffenders.map((o) => `    - ${o.file} (${o.lines})`).join('\n') +
      `\n\n  Split into smaller modules, or (if unavoidable) add an entry to\n` +
      `  scripts/file-size-baseline.json with a justification in review.\n`,
  );
}

if (grownOffenders.length > 0) {
  failed = true;
  console.error(
    `\n\u001b[31m✖ Grandfathered file(s) grew past their baseline (#1843/#422):\u001b[0m\n` +
      grownOffenders.map((o) => `    - ${o.file} (${o.lines} > baseline ${o.base})`).join('\n') +
      `\n\n  These files are supposed to shrink, not grow. Refactor, or lower other\n` +
      `  code — do not raise the baseline without review.\n`,
  );
}

if (failed) process.exit(1);

console.log(
  `[check-file-size] OK — ${files.length} files scanned; no new >${MAX_LINES}-line files, no grandfathered file grew.`,
);
