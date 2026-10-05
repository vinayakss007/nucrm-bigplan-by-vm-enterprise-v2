/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Atomic-counter ratchet (#2344).
 *
 * A counter written as `set({ views: (row.views || 0) + 1 })` reads the row on
 * one round trip and writes a literal back on the next, so concurrent writers
 * overwrite each other and the column drifts below the events it summarises —
 * silently, and unreconstructable afterwards. The increment has to happen in
 * the UPDATE itself (`sql\`${col} + 1\``), the way lib/visitor-tracking.ts
 * already does it.
 *
 * Hard rule, empty baseline: any counter-shaped property in `app/` whose value
 * is a JavaScript read-modify-write fails CI. Genuinely exempt shapes (a
 * single-writer cron, a client-side accumulator) are not object-property
 * writes and so are not matched; if one ever is, the PR must say why.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app'];
const COUNTER_KEY = /^[a-z0-9_]*(count|views|score|attempts|hits|times)$/i;

// The value side of a counter property. `sql\`… + 1\`` is the correct form, so a
// value that opens with `sql` is never a finding; everything that opens with a
// variable/property read and then adds is.
const STALE_NULLISH = /^\(?\s*[\w$.!\[\]()'" ]+?\s*(?:\?\?|\|\|)\s*0\s*\)?\s*\+\s/;
const STALE_BARE = /^[\w$.!\[\]()]+\s*\+\s*[\w$]+\b/;

function counterKeys(line) {
  const keys = [];
  const re = /(?:^|[,{(])\s*([\w$]+)\s*:\s*/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (COUNTER_KEY.test(m[1])) keys.push({ name: m[1], afterColon: line.slice(m.index + m[0].length) });
  }
  return keys;
}

export function findReadModifyWrites(source, file = '<source>') {
  const findings = [];
  source.split('\n').forEach((line, i) => {
    for (const key of counterKeys(line)) {
      const value = key.afterColon.trim();
      if (/^sql[\s`]/.test(value) || value.startsWith('sql`')) continue;
      if (STALE_NULLISH.test(value) || STALE_BARE.test(value)) {
        findings.push({ file, line: i + 1, key: key.name, text: line.trim() });
      }
    }
  });
  return findings;
}

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

if (process.argv[1] && process.argv[1].endsWith('check-atomic-counters.mjs')) {
  const findings = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) {
      console.error(`guard:counters — expected source root "${root}" is missing; failing closed.`);
      process.exit(1);
    }
    for (const file of walk(root)) findings.push(...findReadModifyWrites(readFileSync(file, 'utf8'), file));
  }

  if (findings.length) {
    console.error(`guard:counters — ${findings.length} non-atomic counter write(s):`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`);
    console.error('\nIncrement in SQL instead: set({ col: sql`${col} + 1` }).');
    process.exit(1);
  }
  console.log('guard:counters — OK, every counter write in app/ is atomic.');
}
