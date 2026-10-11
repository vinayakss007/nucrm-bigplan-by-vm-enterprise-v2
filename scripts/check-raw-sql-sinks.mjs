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
 *      → the name goes through validateIdentifier() from '@/lib/sql-allowlist'.
 *   2. `SET [LOCAL] statement_timeout = '${ms}'` — same shape, and the simple
 *      query protocol runs everything after the `;`.
 *      → clamp with validateTimeoutMs() from the same module.
 *
 * A sink is satisfied by any of:
 *   - calling validateIdentifier()/sql.identifier() *inside* the interpolation,
 *     so the proof sits on the line that renders it;
 *   - `raw-sql-guard: allow — <reason>` on the same line;
 *   - a `raw-sql-guard: begin allow — <reason>` … `raw-sql-guard: end allow`
 *     pair, for a multi-line SQL template where a `//` would become part of the
 *     statement (lib/data-integrity.ts has four of those).
 *
 * Scans app/, lib/ and drizzle/ — the paths a request can reach. scripts/ is out
 * of scope on purpose: operator-invoked diagnostics interpolate table names that
 * are literals in the file, and folding them in would mean a marker on every
 * line of them.
 *
 * Baseline is empty by design — every sink named above is either converted or
 * marked with a written reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'lib', 'drizzle'];

const SQL_KEYWORDS = /\b(?:SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE|SET|VALUES|TABLE|INTO|ALTER)\b/;
// `"<interp>"` — the quote pair is literal text in the template.
const QUOTED_INTERPOLATION = /"\s*\$\{[^}]*\}\s*"/;
const TIMEOUT_INTERPOLATION = /statement_timeout\s*=\s*'?\s*\$\{/;
// Proof that the value cannot break its own quote, sitting in the interpolation.
const GUARDED_CALL = /\b(?:validateIdentifier|sql\.identifier)\s*\(/;
const ALLOW_ON_LINE = /raw-sql-guard:\s*allow\b/;
const ALLOW_BEGIN = /raw-sql-guard:\s*begin\s+allow\b/;
const ALLOW_END = /raw-sql-guard:\s*end\s+allow\b/;

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
const unclosedRegions = [];
let files = 0;
let marked = 0;

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    files++;
    const rel = relative(ROOT, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split('\n');
    let region = null;
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      const isComment =
        trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');

      if (ALLOW_BEGIN.test(line)) {
        if (region) unclosedRegions.push(`${rel}:${region.line}: opened again at :${i + 1}`);
        region = { line: i + 1 };
        return;
      }
      if (ALLOW_END.test(line)) {
        if (!region) unclosedRegions.push(`${rel}:${i + 1}: 'end allow' with no 'begin allow'`);
        region = null;
        return;
      }

      // Prose and JSDoc examples quote freely; only code is a sink.
      if (isComment) return;

      const sink =
        (QUOTED_INTERPOLATION.test(line) && SQL_KEYWORDS.test(line)) ||
        TIMEOUT_INTERPOLATION.test(line);
      if (!sink) return;

      if (region || ALLOW_ON_LINE.test(line) || GUARDED_CALL.test(line)) {
        marked++;
        return;
      }
      violations.push(`${rel}:${i + 1}: ${trimmed.slice(0, 110)}`);
    });
    if (region) unclosedRegions.push(`${rel}:${region.line}: 'begin allow' never closed`);
  }
}

if (violations.length > 0 || unclosedRegions.length > 0) {
  if (violations.length > 0) {
    console.error(`[check-raw-sql-sinks] ${violations.length} raw-SQL identifier/timeout sink(s) in ${files} file(s):`);
    for (const v of violations) console.error('  - ' + v);
    console.error(
      "Names go through validateIdentifier() and timeouts through validateTimeoutMs(), " +
        "both from '@/lib/sql-allowlist' — see #2528."
    );
  }
  if (unclosedRegions.length > 0) {
    console.error(`[check-raw-sql-sinks] ${unclosedRegions.length} unbalanced allow region(s):`);
    for (const v of unclosedRegions) console.error('  - ' + v);
    console.error('An unclosed region would silence every sink below it in the file.');
  }
  process.exit(1);
}
console.log(`[check-raw-sql-sinks] OK — ${files} files scanned, 0 unescaped raw-SQL sinks, ${marked} guarded or marked.`);
