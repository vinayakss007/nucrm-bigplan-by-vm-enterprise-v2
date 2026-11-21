/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 — ratchet the legacy bare-error response shape.
 *
 * The canonical envelope (`lib/api/api-envelope.ts`) is `{ ok:true, data }` /
 * `{ ok:false, error:{ code, message } }`. Until every handler is migrated,
 * hundreds of routes still answer `json({ error: "..." })`. This guard pins
 * that existing surface as an exact ledger so the legacy shape can only
 * SHRINK: a new emitter or a growing one fails CI, and a migrated file must
 * have its entry removed. Independent of the in-flight wrapper migration so
 * it can land on its own; the wrapper's own shape is pinned by its unit tests.
 *
 * Mirrors guard:client-fetch's ratchet shape. Deliberately does not rewrite
 * ci.yml: the register currently pins ci.yml line coordinates, and shifting
 * them here would create unrelated drift. Wire the npm script into CI in the
 * follow-up that re-pins those citations.
 *
 * Usage:
 *   node scripts/check-api-envelope.mjs            # verify
 *   node scripts/check-api-envelope.mjs --update    # regenerate the ledger
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const LEDGER = 'scripts/api-envelope-ledger.json';

/** A bare legacy error body: `json({ error: "..." })`. */
const BARE_ERROR_RE = /\bjson\s*\(\s*\{\s*error\s*:\s*['"`]/g;

export function countLegacyErrorBodies(src) {
  return (src.match(BARE_ERROR_RE) ?? []).length;
}

/**
 * Pure check. `entries` maps rel-path → pinned count of legacy bodies.
 * New emitters and growth are fatal; shrinking is progress; a file that no
 * longer emits the shape must drop its ledger entry.
 */
export function checkApiEnvelope(files, readFile, entries) {
  const problems = [];
  const seen = new Set();
  for (const file of files) {
    const count = countLegacyErrorBodies(readFile(file));
    if (count === 0) continue;
    seen.add(file);
    const pinned = entries[file];
    if (pinned === undefined) {
      problems.push(`${file} has ${count} bare { error: "..." } response body/bodies but is not in ${LEDGER} — use the canonical envelope from lib/api/api-envelope.ts, or update the ledger with review (#3408).`);
    } else if (count > pinned) {
      problems.push(`${file} grew from ${pinned} to ${count} bare error bodies — the legacy envelope surface may only shrink (#3408).`);
    }
  }
  for (const file of Object.keys(entries)) {
    if (!seen.has(file)) {
      problems.push(`${file} is pinned in ${LEDGER} but no longer emits a bare error body — remove the stale entry to ratchet down (#3408).`);
    }
  }
  return problems;
}

function main() {
  const files = execFileSync('git', ['ls-files', '--', 'app/api/**/route.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).split('\n').map((s) => s.trim()).filter(Boolean).sort();
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  const ledgerPath = join(ROOT, LEDGER);

  if (process.argv.includes('--update')) {
    const entries = {};
    for (const file of files) {
      const count = countLegacyErrorBodies(read(file));
      if (count > 0) entries[file.split(sep).join('/')] = count;
    }
    writeFileSync(ledgerPath, `${JSON.stringify(
      Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))), null, 2,
    )}\n`);
    console.log(`[check-api-envelope] ledger updated: ${Object.keys(entries).length} route file(s) still emit the legacy shape.`);
    return;
  }

  const entries = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const problems = checkApiEnvelope(files, read, entries);
  if (problems.length > 0) {
    console.error(`\n[check-api-envelope] FAIL — ${problems.length} problem(s):\n\n` +
      problems.map((p) => `    - ${p}`).join('\n') + '\n');
    process.exit(1);
  }
  console.log(`[check-api-envelope] OK — ${Object.keys(entries).length} pinned route file(s); no new legacy error envelope (#3408).`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
