/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Zod schema drift guard (#1883, #2258, #2819).
 *
 * lib/api/schemas.ts (the monolith) was partially migrated into per-domain
 * submodules under lib/api/schemas/* and the migration was never finished: 135
 * schemas were defined in BOTH places. Routes import the monolith, so which
 * validation a payload met depended on which path the route imported, and #2258
 * and #2286 each had to edit two copies of one contract.
 *
 * #2819 collapsed those 135: the submodule holds the ONE definition and the
 * monolith imports and re-exports it. This guard's job is therefore no longer
 * "keep the two copies in step" — it is "there must never be two copies", which
 * is the only way the drift it was written for cannot come back.
 *
 * - A schema defined in BOTH the monolith and a submodule → FAIL, whether the
 *   bodies match (a re-created duplicate) or differ (the original #1883 bug).
 * - A baseline entry that is no longer duplicated → prints a hint to remove it
 *   from the baseline (ratchet down).
 *
 * Fix: move the definition into its domain submodule and re-export it from the
 * monolith — never edit the monolith to match, which is what the pre-#2819
 * advice here said and what re-creates the pair.
 * `tests/unit/schema-schemas-single-source.test.ts` pins the same rule and also
 * checks object identity and the set of names reachable from the barrel.
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

const duplicated = Object.keys(mono).filter((k) => sub[k] !== undefined);
const divergent = duplicated.filter((k) => sub[k] !== mono[k]);

const newDupes = duplicated.filter((k) => !KNOWN_DRIFT.has(k));
const resolved = [...KNOWN_DRIFT].filter((k) => !duplicated.includes(k));

if (resolved.length > 0) {
  console.log(
    `\n\u001b[36mℹ ${resolved.length} baseline drift entr(y/ies) resolved — remove from scripts/schema-drift-baseline.json:\u001b[0m\n` +
      resolved.map((k) => `    - ${k}`).join('\n'),
  );
}

if (newDupes.length > 0) {
  console.error(
    '\n\u001b[31m✖ Schema drift guard failed (#1883, #2819).\u001b[0m\n' +
      '\n  These schemas are defined in BOTH lib/api/schemas.ts AND a submodule\n' +
      '  under lib/api/schemas/*:\n\n' +
      newDupes
        .map((k) => `    - ${k}${divergent.includes(k) ? '  (and the two bodies DIFFER)' : ''}`)
        .join('\n') +
      '\n\n  A route importing one path and a route importing the other then\n' +
      '  validate different payloads — that is how #2258 and #2286 each needed\n' +
      '  two edits for one contract. #2819 removed the 135 copies that existed:\n' +
      '  the submodule holds the definition and lib/api/schemas.ts re-exports it.\n' +
      '  Do the same — move the body into its domain module, import it back here,\n' +
      '  and do NOT edit one copy to match the other.\n',
  );
  process.exit(1);
}

console.log(
  '[check-schema-drift] OK — every zod schema is defined exactly once across lib/api/schemas.ts and lib/api/schemas/*.',
);
