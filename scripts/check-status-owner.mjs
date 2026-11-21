/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — a status write to a registered table must go through
 * `transitionStatus`/`transitionStatusMany`, the single owner of a status
 * transition. This guard finds the remaining hand-written
 * `.update(<table>).set({ status: ... })` writes, pins them in an exact ledger,
 * and fails CI when a file adds a NEW one. Shrinking the ledger is progress;
 * a stale entry fails so the list cannot silently rot.
 *
 * It deliberately checks only the tables present in `lib/state/transitions.ts`:
 * an entity outside the registry has no transition rule to own yet.
 *
 * Usage:
 *   node scripts/check-status-owner.mjs            # verify
 *   node scripts/check-status-owner.mjs --update    # regenerate the ledger
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const ROOTS = ['app', 'lib'];
const SOURCE_EXT = new Set(['.ts', '.tsx']);
const LEDGER = 'scripts/status-owner-ledger.json';

/** The registry's tables — kept in sync with lib/state/transitions.ts by hand. */
export const REGISTERED_TABLES = [
  'supportTickets', 'quotes', 'productTemplates', 'tenantMembers',
];

// One expression: the UPDATE chain, .set({ ... }), bounded at the object's
// closing `})`. A window scan would catch a LATER write's `status:` key and
// flag a file whose only status write already goes through the helper.
const DIRECT_WRITE_RE = new RegExp(
  `\\.update\\(\\s*(${REGISTERED_TABLES.join('|')})\\s*\\)\\s*\\.set\\(\\s*\\{([\\s\\S]*?)\\n?\\s*\\}\\s*\\)`,
  'g',
);

/** Blank out comments so a commented-out write does not count. */
export function maskComments(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let j = from; j < to && j < out.length; j++) if (out[j] !== '\n') out[j] = ' ';
  };
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, src.length)); i = j + 2; continue;
    }
    i++;
  }
  return out.join('');
}

/** Count hand-written status writes in one source file. */
export function countDirectStatusWrites(src) {
  const clean = maskComments(src);
  let total = 0;
  DIRECT_WRITE_RE.lastIndex = 0;
  let m;
  while ((m = DIRECT_WRITE_RE.exec(clean)) !== null) {
    if (/\bstatus\s*:/.test(m[2] ?? '')) total++;
  }
  return total;
}

function walk(root, dir, out) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(root, p, out);
    else if (SOURCE_EXT.has(extname(e.name))) out.push(relative(root, p).split(sep).join('/'));
  }
}

export function collect(root = '.') {
  const files = [];
  for (const r of ROOTS) walk(root, join(root, r), files);
  const entries = {};
  for (const f of files.sort()) {
    const n = countDirectStatusWrites(readFileSync(join(root, f), 'utf8'));
    if (n > 0) entries[f] = n;
  }
  return entries;
}

export function check(actual, pinned) {
  const problems = [];
  for (const [file, n] of Object.entries(actual)) {
    const was = pinned[file];
    if (was === undefined) problems.push(`${file} has ${n} direct status write(s) and is not pinned — route through transitionStatus or update the ledger with review (#3407).`);
    else if (n > was) problems.push(`${file} grew from ${was} to ${n} direct status write(s) — the bypass surface may only shrink (#3407).`);
  }
  for (const file of Object.keys(pinned)) {
    if (actual[file] === undefined) problems.push(`${file} is pinned but has no direct status write — remove the stale entry to ratchet down (#3407).`);
  }
  return problems;
}

function main() {
  const root = join(import.meta.dirname, '..');
  const ledgerPath = join(root, LEDGER);
  const actual = collect(root);
  if (process.argv.includes('--update')) {
    writeFileSync(ledgerPath, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`[check-status-owner] ledger updated: ${Object.keys(actual).length} file(s) with direct status writes.`);
    return;
  }
  const pinned = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const problems = check(actual, pinned);
  if (problems.length) {
    console.error('\n[check-status-owner] FAIL — direct status writes outside the transition owner:\n');
    for (const p of problems) console.error(`    - ${p}`);
    console.error('');
    process.exit(1);
  }
  const total = Object.values(actual).reduce((a, b) => a + b, 0);
  console.log(`[check-status-owner] OK — ${Object.keys(actual).length} pinned file(s), ${total} direct status write(s); no new bypass (#3407).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
