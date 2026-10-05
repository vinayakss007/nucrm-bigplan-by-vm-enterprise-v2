/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * CSV-blob guard (#2340).
 *
 * Any file under app/ that hands the browser a text/csv Blob must import the
 * shared escaper @/lib/csv. The six client "Export CSV" paths that quoted only
 * , " and \n let a formula payload from the unauthenticated lead form execute
 * in the operator's spreadsheet; this guard stops a seventh appearing.
 *
 * Escape hatch: append `// csv-guard: allow — <reason>` to the Blob line.
 * Baseline is empty by design — every app/ CSV builder goes through lib/csv.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, 'app');

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
    if (line.includes('csv-guard: allow')) return;
    const makesBlob = /new\s+Blob\s*\(/.test(line);
    const isCsv = /text\/csv/.test(line);
    if (!(makesBlob && isCsv)) return;
    // the escaper may be imported under any local alias — require the module,
    // not the name `csvRow`, so refactors cannot open a silent hole
    if (!/from\s+'@\/lib\/csv'/.test(lines.join('\n'))) {
      violations.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 110)}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`[check-csv-blob] ${violations.length} text/csv Blob(s) built without @/lib/csv in ${files} file(s):`);
  for (const v of violations) console.error('  - ' + v);
  console.error("Build rows with csvRow() from '@/lib/csv' so formula prefixes are neutralised — see #2340.");
  process.exit(1);
}
console.log(`[check-csv-blob] OK — ${files} files scanned, 0 unescaped text/csv Blob builders.`);
