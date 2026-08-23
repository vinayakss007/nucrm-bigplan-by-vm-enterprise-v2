#!/usr/bin/env node
/**
 * Adds the abetworks.in proprietary header to all first-party source files.
 * Idempotent: skips files that already carry the banner.
 *
 * Usage: node scripts/add-headers.mjs [--check]
 *   --check  exit 1 if any file is missing the banner (CI mode), no writes
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const BANNER = [
  '/*!',
  ' * NuCRM Enterprise — Property of abetworks.in',
  ' * Copyright (c) 2026 abetworks.in. All Rights Reserved.',
  ' * Proprietary & confidential. Unauthorized copying or distribution is prohibited.',
  ' */',
  '',
].join('\n');

const MARKER = 'Property of abetworks.in';

const ROOTS = ['app', 'components', 'lib', 'hooks', 'drizzle/schema'];
const ROOT_FILES = [
  'worker.ts', 'realtime.ts', 'proxy.ts',
  'instrumentation.ts', 'instrumentation-client.ts',
  'sentry.client.config.ts', 'sentry.server.config.ts', 'sentry.edge.config.ts',
];
const EXTS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'coverage', '__tests__']);

/** Files where a leading banner could break tooling (directive-sensitive). */
const EXEMPT = new Set([
  'drizzle/migrations', // handled separately below (SQL not JS)
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith('.') || EXEMPT.has(p)) continue;
      yield* walk(p);
    } else if (EXTS.has(extname(name))) {
      yield p;
    }
  }
}

const targets = [];
for (const root of ROOTS) {
  try { targets.push(...walk(root)); } catch { /* dir missing */ }
}
for (const f of ROOT_FILES) {
  try { statSync(f); targets.push(f); } catch { /* missing */ }
}

let added = 0, skipped = 0;
for (const file of targets) {
  const src = readFileSync(file, 'utf8');
  if (src.includes(MARKER)) { skipped++; continue; }
  if (process.argv.includes('--check')) continue;
  writeFileSync(file, BANNER + src);
  added++;
}

if (process.argv.includes('--check')) {
  const missing = targets.length - skipped;
  if (missing > 0) {
    console.error(`[headers] ${missing} file(s) missing proprietary header`);
    process.exit(1);
  }
  console.log('[headers] all files carry the proprietary header');
} else {
  console.log(`[headers] banner added to ${added} file(s); ${skipped} already compliant`);
}
