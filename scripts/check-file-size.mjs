/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * File-size ratchet (#1843 / #422).
 *
 * Goal: stop tech-debt growth without a risky mass-refactor.
 *  - Any NEW file (not in the baseline) over MAX_LINES fails CI.
 *  - Any grandfathered file that GROWS past its recorded baseline fails CI.
 *  - A grandfathered file that SHRANK to <= MAX_LINES prints a hint to remove
 *    its baseline entry (ratchet down).
 *
 * As large files get refactored below 500 lines, delete their entries from
 * scripts/file-size-baseline.json so the ceiling tightens over time.
 *
 * `--only <file>` scopes the report to the named files (#3400). Until then a
 * suite that meant "my panel stays under its ceiling" could only say it by
 * shelling out to this repo-wide guard and asserting exit 0, so it inherited
 * everybody's arithmetic: the landing page running 16 lines over its baseline
 * failed 88 suites at once, and `main` measured 100 failed files for one JSON
 * number. The scope is validated rather than assumed — a name that is not a
 * .ts/.tsx under app, lib or components, that climbs out of the tree, or that
 * does not exist is a failure, because an `--only` typo that scanned nothing
 * would report OK and the guard would be gone while still looking green.
 *
 * Usage: node scripts/check-file-size.mjs [--only <file>[,<file>…]] [--json]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_LINES = 500;
export const ROOTS = ['app', 'lib', 'components'];
export const BASELINE = 'scripts/file-size-baseline.json';

export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

export function lineCount(file) {
  const src = readFileSync(file, 'utf8');
  // match `wc -l` semantics (count newlines)
  let n = 0;
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

export function loadBaseline() {
  return JSON.parse(readFileSync(BASELINE, 'utf8'));
}

/**
 * Refuses anything it does not understand: a misspelled `--onlyy path` that
 * fell back to the repo-wide walk would let a scoped suite pass while checking
 * a thousand files it has no opinion about.
 */
export function parseArgs(argv) {
  const only = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg.startsWith('--only=')) only.push(...arg.slice('--only='.length).split(','));
    else if (arg === '--only') {
      // `--only a b c` and `--only a,b` both mean the same three files; the
      // argv-array form is what a spawnSync caller writes naturally.
      let taken = 0;
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        only.push(...argv[++i].split(','));
        taken++;
      }
      if (taken === 0) throw new Error('--only needs a file path');
    } else throw new Error(`unknown argument ${JSON.stringify(arg)} — expected --only <file> or --json`);
  }
  return { only: [...new Set(only.filter((p) => p !== '').map(normalize))], json };
}

function normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Why this scoped name cannot be checked — empty means it can. Every reason is
 * a defect in the caller, not in the tree, so they are reported together.
 */
export function scopeProblems(file) {
  if (file.startsWith('/') || file.split('/').includes('..')) {
    return [`${file} is outside the repository root`];
  }
  const problems = [];
  if (!ROOTS.some((root) => file.startsWith(`${root}/`))) {
    problems.push(`${file} is not under ${ROOTS.join(', ')} — the ratchet has no opinion about it`);
  }
  if (!/\.(ts|tsx)$/.test(file)) problems.push(`${file} is not a .ts/.tsx source file`);
  if (problems.length) return problems;
  if (!existsSync(file)) return [`${file} does not exist`];
  if (!statSync(file).isFile()) return [`${file} is not a file`];
  return problems;
}

/** The one-file verdict: an offender record, or null when the file complies. */
export function verdict(file, lines, baseline) {
  const base = baseline[file];
  if (base === undefined) return lines > MAX_LINES ? { file, lines, base: null, kind: 'new' } : null;
  return lines > base ? { file, lines, base, kind: 'grown' } : null;
}

export function analyze(files, baseline) {
  const rows = files.map((file) => ({ file, lines: lineCount(file), base: baseline[file] ?? null }));
  const offenders = [];
  const shrunk = [];
  for (const row of rows) {
    const bad = verdict(row.file, row.lines, baseline);
    if (bad) offenders.push(bad);
    else if (row.base !== null && row.lines <= MAX_LINES) shrunk.push({ file: row.file, lines: row.lines });
  }
  return { rows, offenders, shrunk };
}

export function run(argv = process.argv.slice(2)) {
  const { only, json } = parseArgs(argv);
  const baseline = loadBaseline();
  const problems = only.flatMap(scopeProblems);
  const scoped = only.length > 0;
  const files = scoped ? only : ROOTS.flatMap(walk);
  // A bad scope never reaches the walk, so it cannot be rescued by a clean
  // answer about some other file.
  const { rows, offenders, shrunk } = problems.length ? { rows: [], offenders: [], shrunk: [] } : analyze(files, baseline);
  return { scoped, scope: only, maxLines: MAX_LINES, files, rows, offenders, shrunk, problems, json };
}

/** Failures go to stderr and the ratchet hint to stdout, exactly as the
 *  repo-wide report always did — suites quote both, and some quote one. */
export function format(result) {
  const error = [];
  const log = [];
  if (result.problems.length > 0) {
    error.push(
      `\n\u001b[31m✖ The --only scope names nothing the ratchet can check (#3400):\u001b[0m\n` +
        result.problems.map((p) => `    - ${p}`).join('\n') +
        `\n\n  A scoped run that checked no file MUST NOT report OK — that is a guard\n` +
        `  that stopped guarding. Name a real .ts/.tsx file under ${ROOTS.join(', ')}.\n`,
    );
    return { log, error, exit: 1 };
  }

  if (result.shrunk.length > 0) {
    log.push(
      `\n\u001b[36mℹ ${result.shrunk.length} grandfathered file(s) are now ≤ ${MAX_LINES} lines — remove them from the baseline to tighten the ratchet:\u001b[0m\n` +
        result.shrunk.map((s) => `    - ${s.file} (${s.lines})`).join('\n'),
    );
  }

  let failed = false;
  for (const kind of ['new', 'grown']) {
    const list = result.offenders.filter((o) => o.kind === kind);
    if (list.length === 0) continue;
    failed = true;
    if (kind === 'new') {
      error.push(
        `\n\u001b[31m✖ New file(s) exceed ${MAX_LINES} lines (#1843/#422):\u001b[0m\n` +
          list.map((o) => `    - ${o.file} (${o.lines})`).join('\n') +
          `\n\n  Split into smaller modules, or (if unavoidable) add an entry to\n` +
          `  ${BASELINE} with a justification in review.\n`,
      );
    } else {
      error.push(
        `\n\u001b[31m✖ Grandfathered file(s) grew past their baseline (#1843/#422):\u001b[0m\n` +
          list.map((o) => `    - ${o.file} (${o.lines} > baseline ${o.base})`).join('\n') +
          `\n\n  These files are supposed to shrink, not grow. Refactor, or lower other\n` +
          `  code — do not raise the baseline without review.\n`,
      );
    }
  }

  if (failed) return { log, error, exit: 1 };
  const scanned = result.scoped ? `${result.files.length} file(s) scanned (scoped to --only)` : `${result.files.length} files scanned`;
  log.push(`[check-file-size] OK — ${scanned}; no new >${MAX_LINES}-line files, no grandfathered file grew.`);
  return { log, error, exit: 0 };
}

function main() {
  let result;
  try {
    result = run();
  } catch (err) {
    console.error(`[check-file-size] ${err.message}`);
    process.exit(1);
  }
  if (result.json) {
    process.stdout.write(
      JSON.stringify(
        {
          scoped: result.scoped,
          scope: result.scope,
          maxLines: result.maxLines,
          scanned: result.files.length,
          files: result.rows,
          offenders: result.offenders,
          shrunk: result.shrunk,
          scopeProblems: result.problems,
        },
        null,
        2,
      ) + '\n',
    );
    process.exit(result.offenders.length + result.problems.length > 0 ? 1 : 0);
  }
  const { log, error, exit } = format(result);
  for (const line of log) console.log(line);
  for (const line of error) console.error(line);
  process.exit(exit);
}

if (process.argv[1]?.includes('check-file-size')) main();
