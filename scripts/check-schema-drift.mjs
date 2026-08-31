/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Zod schema drift guard (#1883).
 *
 * lib/api/schemas.ts (the monolith, imported by ~89 files) was partially
 * migrated into per-domain submodules under lib/api/schemas/*. The migration
 * was never finished and the two copies DRIFTED: dozens of schemas are defined
 * in BOTH places with DIFFERENT bodies. Because routes import the monolith,
 * switching an import to the barrel/submodule would silently change request
 * validation — a latent correctness bug.
 *
 * This guard fails when a schema is defined in BOTH the monolith and a
 * submodule with a DIFFERENT body, using a baseline allowlist to grandfather
 * the KNOWN drift so we can pay it down incrementally without blocking CI.
 *
 * - NEW drift (a schema newly diverging, or a new duplicated-and-different
 *   schema not in the baseline) → FAIL.
 * - A baseline entry that is now IDENTICAL (drift resolved) → prints a hint to
 *   remove it from the baseline (ratchet down).
 *
 * Fix drift by making the two copies identical (the monolith is canonical for
 * everything that has live importers — see #1883), then remove the entry here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const KNOWN_DRIFT = new Set(
  JSON.parse(readFileSync('scripts/schema-drift-baseline.json', 'utf8')).knownDrift,
);

// Strip line/block comments so drift is judged on Zod STRUCTURE, not prose.
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (avoid eating "://")
}

// Extract each `export const NAME = <body>;` by scanning from `=` to the first
// TOP-LEVEL `;` (respecting brackets and strings), so trailing comments or the
// next declaration are never captured into the body. Judged on Zod STRUCTURE.
function extract(src) {
  const map = {};
  const re = /export const (\w+Schema)\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 0;
    let inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      const prev = src[i - 1];
      if (inStr) {
        if (c === inStr && prev !== '\\') inStr = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ';' && depth === 0) break;
    }
    map[m[1]] = stripComments(src.slice(re.lastIndex, i)).replace(/\s+/g, ' ').trim();
    re.lastIndex = i;
  }
  return map;
}

const mono = extract(readFileSync('lib/api/schemas.ts', 'utf8'));
const subDir = 'lib/api/schemas';
const sub = {}; // name -> body (last submodule wins; drift is per-name)
for (const f of readdirSync(subDir)) {
  if (!f.endsWith('.ts') || f === 'index.ts') continue;
  const ex = extract(readFileSync(join(subDir, f), 'utf8'));
  for (const [k, v] of Object.entries(ex)) sub[k] = v;
}

const currentDrift = Object.keys(mono).filter((k) => sub[k] !== undefined && sub[k] !== mono[k]);

const newDrift = currentDrift.filter((k) => !KNOWN_DRIFT.has(k));
const resolved = [...KNOWN_DRIFT].filter((k) => !currentDrift.includes(k));

if (resolved.length > 0) {
  console.log(
    `\n\u001b[36mℹ ${resolved.length} baseline drift entr(y/ies) resolved — remove from scripts/schema-drift-baseline.json:\u001b[0m\n` +
      resolved.map((k) => `    - ${k}`).join('\n'),
  );
}

if (newDrift.length > 0) {
  console.error(
    '\n\u001b[31m✖ Schema drift guard failed (#1883).\u001b[0m\n' +
      '\n  These schemas are defined in BOTH lib/api/schemas.ts AND a submodule\n' +
      '  under lib/api/schemas/* with DIFFERENT bodies, and are not in the known\n' +
      '  baseline. Switching an import between them would silently change\n' +
      '  validation:\n\n' +
      newDrift.map((k) => `    - ${k}`).join('\n') +
      '\n\n  Fix: make the two copies identical (the monolith is canonical for\n' +
      '  anything with live importers — see #1883), then this passes.\n',
  );
  process.exit(1);
}

console.log(
  `[check-schema-drift] OK — no NEW schema drift (${currentDrift.length} known/grandfathered).`,
);
