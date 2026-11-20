/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — client-side raw `fetch(...)` is why a refused request so often
 * renders as "no data": every caller re-implements (or forgets) the status
 * check. `fetchJsonSafe` / `fetchJsonOrThrow` are the shared helpers now, but
 * the migration is incremental. This guard pins the existing surface as an
 * exact ledger and fails CI when a client file adds a NEW raw fetch call —
 * the same ratchet shape as guard:tenant-db-context. It does not touch
 * server-only routes; those fetches are not the panel/empty-state class.
 *
 * Usage:
 *   node scripts/check-client-fetch.mjs            # verify
 *   node scripts/check-client-fetch.mjs --update    # regenerate the ledger
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

const ROOTS = ['app', 'components'];
const SOURCE_EXT = new Set(['.ts', '.tsx']);
const FETCH_RE = /\bfetch\s*\(/g;
const LEDGER = 'scripts/client-fetch-ledger.json';

/** All client-component source files under app/ and components/. */
export function clientFiles(root = '.') {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (SOURCE_EXT.has(extname(entry.name))) files.push(p);
    }
  };
  for (const r of ROOTS) walk(join(root, r));
  return files;
}

/** Raw fetch call sites in one source file. */
export function countRawFetches(src) {
  return (src.match(FETCH_RE) ?? []).length;
}

export function isClientSource(src) {
  return /['"]use client['"]/.test(src);
}

/**
 * Pure check. `entries` is a map of rel-path → pinned count.
 * A file may shrink (fewer raw fetches is progress); it may not grow, and a
 * file with raw fetches may not appear without a ledger entry.
 */
export function checkClientFetch(files, readFile, entries) {
  const problems = [];
  const seen = new Set();
  for (const file of files) {
    const src = readFile(file);
    if (!isClientSource(src)) continue;
    const count = countRawFetches(src);
    if (count === 0) continue;
    seen.add(file);
    const pinned = entries[file];
    if (pinned === undefined) {
      problems.push(`${file} has ${count} raw fetch call(s) but is not in ${LEDGER} — use fetchJsonSafe/fetchJsonOrThrow or update the ledger with review (#3408).`);
    } else if (count > pinned) {
      problems.push(`${file} grew from ${pinned} to ${count} raw fetch call(s) — the client-fetch surface may only shrink (#3408).`);
    }
  }
  for (const file of Object.keys(entries)) {
    if (!seen.has(file)) {
      problems.push(`${file} is pinned in ${LEDGER} but has no raw fetch call — remove the stale entry to ratchet down (#3408).`);
    }
  }
  return problems;
}

function main() {
  const root = join(import.meta.dirname, '..');
  const ledgerPath = join(root, LEDGER);
  const files = clientFiles(root);
  const read = (p) => readFileSync(p, 'utf8');

  if (process.argv.includes('--update')) {
    const entries = {};
    for (const file of files) {
      const src = read(file);
      if (!isClientSource(src)) continue;
      const count = countRawFetches(src);
      if (count > 0) entries[relative(root, file).split(sep).join('/')] = count;
    }
    writeFileSync(ledgerPath, `${JSON.stringify(
      Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))), null, 2,
    )}\n`);
    console.log(`[check-client-fetch] ledger updated: ${Object.keys(entries).length} client file(s) with raw fetch.`);
    return;
  }

  const entries = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const rel = (p) => relative(root, p).split(sep).join('/');
  const relFiles = files.map(rel);
  const problems = checkClientFetch(relFiles, (p) => read(join(root, p)), entries);
  if (problems.length > 0) {
    console.error(`\n[check-client-fetch] FAIL — ${problems.length} problem(s):\n\n` +
      problems.map((p) => `    - ${p}`).join('\n') + '\n');
    process.exit(1);
  }
  console.log(`[check-client-fetch] OK — ${Object.keys(entries).length} pinned client file(s); no new raw fetch call sites (#3408).`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
