/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Counter-increment ratchet (#2344).
 *
 * Flags JS read-modify-write counter updates in app/api/**:
 *
 *   set({ views: (article.views || 0) + 1 })            ✗ loses concurrent writes
 *   set({ views: sql`${kbArticles.views} + 1` })        ✓ atomic in Postgres
 *
 * Under READ COMMITTED the read half races every concurrent writer: N events
 * arrive, the counter moves by less than N, silently. The atomic form was
 * already the house style (lib/visitor-tracking.ts, forms.submissionsCount
 * #2334) — this guard stops the other half of the repo from regressing.
 *
 * Escape hatch: append `// counter-ratchet: allow — <reason>` to the offending
 * line. Baseline is empty by design; any allow-list entry must carry a written
 * reason, not a silent grandfather.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, 'app', 'api');

// key ends in a counter-ish name AND the value is `(x ?? 0) + n` / `(x || 0) + n`
const COUNTER_RMW =
  /\b[A-Za-z_]*(?:count|Count|views|Views|score|Score|attempts|Attempts|hits|Hits)\w*\s*:\s*\([^)]*(?:\?\?|\|\|)\s*0\s*\)?\s*\+\s*\d+/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const violations = [];
let files = 0;
for (const file of walk(SCAN_DIR)) {
  files++;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('counter-ratchet: allow')) return;
    if (COUNTER_RMW.test(line)) {
      violations.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 110)}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`[check-counter-increments] ${violations.length} read-modify-write counter update(s) in ${files} file(s):`);
  for (const v of violations) console.error('  - ' + v);
  console.error('Use the SQL-side form instead: set({ col: sql`${table.col} + 1` }) — see #2344.');
  process.exit(1);
}
console.log(`[check-counter-increments] OK — ${files} files scanned, 0 read-modify-write counter updates.`);
