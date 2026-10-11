/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Raw-SQL sink guard (#2528).
 *
 * Two ways a dynamic name reaches Postgres as text instead of as a parameter,
 * both of which let the name finish its own quote and start a new statement:
 *
 *   1. `FROM "${table}"` / `SET "${col}"=$1` — the wrapping quotes are part of
 *      the template, so a name containing `"` is a write primitive. Measured on
 *      PostgreSQL 16: the key `is_super_admin" = true, "email` granted super
 *      admin, and a hostile table name returned a second result set (emails)
 *      while the caller read a normal count.
 *      → use quoteIdentifier() from '@/lib/db/identifier'.
 *   2. `SET statement_timeout = '${ms}'` — same shape, and the simple query
 *      protocol runs everything after the `;`.
 *      → use statementTimeoutSql() from '@/lib/db/query-timeout'.
 *
 * Scans app/, lib/ and drizzle/ — the paths a request can reach. scripts/ is
 * out of scope on purpose: operator-invoked diagnostics interpolate table names
 * that are literals in the file, and folding them in would mean an allow-comment
 * on every line of them.
 *
 * Escape hatch: append `// raw-sql-guard: allow — <reason>` to the line.
 * Baseline is empty by design — every sink named above is converted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'lib', 'drizzle'];

// The one module allowed to write the timeout literal; it is the shared builder.
const TIMEOUT_SINK_BUILDER = 'lib/db/query-timeout.ts';

const SQL_KEYWORDS = /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE|SET|VALUES|TABLE|INTO|ALTER)\b/;
const QUOTED_INTERPOLATION = /"\s*\$\{[^}]*\}\s*"/;
const TIMEOUT_INTERPOLATION = /statement_timeout\s*=\s*'?\s*\$\{/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}

const violations = [];
let files = 0;

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    files++;
    const rel = relative(ROOT, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      // Prose and JSDoc examples quote freely; only code is a sink.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (line.includes('raw-sql-guard: allow')) return;

      if (QUOTED_INTERPOLATION.test(line) && SQL_KEYWORDS.test(line)) {
        violations.push(`${rel}:${i + 1}: ${trimmed.slice(0, 110)}`);
      }
      if (TIMEOUT_INTERPOLATION.test(line) && rel !== TIMEOUT_SINK_BUILDER) {
        violations.push(`${rel}:${i + 1}: ${trimmed.slice(0, 110)}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`[check-raw-sql-sinks] ${violations.length} raw-SQL identifier/timeout sink(s) in ${files} file(s):`);
  for (const v of violations) console.error('  - ' + v);
  console.error(
    "Names go through quoteIdentifier() from '@/lib/db/identifier' and timeouts " +
      "through statementTimeoutSql() from '@/lib/db/query-timeout' — see #2528."
  );
  process.exit(1);
}
console.log(`[check-raw-sql-sinks] OK — ${files} files scanned, 0 unescaped raw-SQL sinks.`);
