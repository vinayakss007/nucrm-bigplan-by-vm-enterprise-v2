/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * The scripts/** typecheck floor (#3413).
 *
 * `tsconfig.json` excludes `scripts/**`, so the directory that touches the
 * database was never type-checked: #3381's TLS pass shipped seven duplicate
 * `import { pgSslConfig }` lines (TS2300) and `drift-check.ts`'s `--json` branch
 * has referenced two names that do not exist since #2508 (TS2304 / TS18004) —
 * a ReferenceError on the path an operator takes when the schema already
 * disagrees. `scripts/tsconfig.scripts.json` gives the directory a typecheck
 * path; this screen is what makes it stick.
 *
 * It pins what is known rather than pretending it is clean: the 108 errors the
 * first run found live in `scripts/scripts-ts-baseline.json` as
 * `file + code + message + count`, and the screen fails when
 *   - a type error appears that the baseline has never seen, or
 *   - a baselined error disappears or thins out (shrink-only — the floor can
 *     only come down, so a fix is recorded instead of quietly orphaned).
 *
 * Line numbers are deliberately NOT part of the identity: editing ten lines
 * above an error would otherwise look like ten new errors (#3412's citation
 * churn, in miniature).
 *
 * Usage: node scripts/check-scripts-typecheck.mjs [--json]
 *        node scripts/check-scripts-typecheck.mjs --from-file <tsc.log> [root]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

export const ROOT = process.cwd();
export const TSCONFIG_REL = 'scripts/tsconfig.scripts.json';
export const BASELINE_REL = 'scripts/scripts-ts-baseline.json';
/** A `tsc` run that produced none of these codes did not run at all. */
export const TSC_EXIT_OK = 0;
export const TSC_EXIT_ERRORS = 2;

const DIAGNOSTIC = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** Parse a `tsc --noEmit` transcript into `{ file, line, code, message }`. */
export function parseDiagnostics(stdout) {
  const found = [];
  const unparsed = [];
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    const m = DIAGNOSTIC.exec(line.trim());
    if (m) found.push({ file: m[1], line: Number(m[2]), code: m[4], message: m[5] });
    else if (/error TS\d+/.test(line)) unparsed.push(line);
  }
  return { diagnostics: found, unparsed };
}

/**
 * The identity of a baselined error: where it lives, what the compiler calls
 * it, and what it says — never which line it sits on.
 */
export function keyOf(d) {
  return `${d.file}|${d.code}|${d.message}`;
}

export function tally(diagnostics) {
  const counts = new Map();
  for (const d of diagnostics) {
    const k = keyOf(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function loadBaseline(root = ROOT) {
  const file = join(root, BASELINE_REL);
  if (!existsSync(file)) throw new Error(`${BASELINE_REL} is missing — the floor has to be recorded somewhere`);
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(doc.entries)) throw new Error(`${BASELINE_REL} has no entries array`);
  const seenKeys = new Set();
  for (const e of doc.entries) {
    if (!e.file || !e.code || !e.message || !Number.isInteger(e.count) || e.count < 1) {
      throw new Error(`${BASELINE_REL} entry needs file, code, message and a positive integer count: ${JSON.stringify(e)}`);
    }
    const key = `${e.file}|${e.code}|${e.message}`;
    if (seenKeys.has(key)) {
      throw new Error(`${BASELINE_REL} records ${e.file} ${e.code} twice — one entry per error identity, with the total in its count`);
    }
    seenKeys.add(key);
  }
  return doc.entries;
}

/**
 * Compare what the compiler said with what the floor allows.
 * `findings` is every error the baseline has never seen (with its line, which
 * the report prints but the identity ignores); `stale` is every baseline entry
 * whose errors have thinned out or vanished.
 */
export function compare(entries, diagnostics) {
  const allowed = new Map(entries.map((e) => [`${e.file}|${e.code}|${e.message}`, e]));
  const counts = tally(diagnostics);
  const findings = [];
  const stale = [];

  for (const d of diagnostics) {
    if (allowed.has(keyOf(d))) continue;
    findings.push({ file: d.file, line: d.line, code: d.code, message: d.message });
  }

  for (const e of entries) {
    const actual = counts.get(`${e.file}|${e.code}|${e.message}`) ?? 0;
    if (actual < e.count) {
      stale.push({ file: e.file, code: e.code, message: e.message, expected: e.count, actual });
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  stale.sort((a, b) => a.file.localeCompare(b.file) || a.code.localeCompare(b.code));
  return { findings, stale };
}

/** Run the scripts project through `tsc`. Fails closed if the run is not a run. */
export function typecheck(root = ROOT) {
  const config = join(root, TSCONFIG_REL);
  if (!existsSync(config)) throw new Error(`${TSCONFIG_REL} is missing — scripts/** would be unchecked again`);
  const res = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config, '--noEmit'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw new Error(`tsc could not run: ${res.error.message}`);
  const { diagnostics, unparsed } = parseDiagnostics(res.stdout);
  if (unparsed.length) {
    throw new Error(`tsc printed ${unparsed.length} diagnostic line(s) this screen cannot parse: ${unparsed[0]}`);
  }
  if (res.status !== TSC_EXIT_OK && res.status !== TSC_EXIT_ERRORS && diagnostics.length === 0) {
    throw new Error(`tsc exited ${res.status} without a single diagnostic — ${(res.stderr || 'no stderr').trim().slice(0, 300)}`);
  }
  if (res.status === TSC_EXIT_OK && diagnostics.length > 0) {
    throw new Error('tsc exited 0 while reporting errors; the transcript cannot be trusted');
  }
  return diagnostics;
}

export function run(root = ROOT, diagnostics = typecheck(root)) {
  const entries = loadBaseline(root);
  const { findings, stale } = compare(entries, diagnostics);
  return {
    errors: diagnostics.length,
    baselined: entries.reduce((n, e) => n + e.count, 0),
    files: new Set(diagnostics.map((d) => d.file)).size,
    findings,
    stale,
    ok: findings.length === 0 && stale.length === 0,
  };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const fromFile = args.includes('--from-file') ? args[args.indexOf('--from-file') + 1] : null;
  const root = resolve(args.filter((a) => !a.startsWith('--') && a !== fromFile)[0] ?? ROOT);

  let diagnostics;
  try {
    if (fromFile) {
      const parsed = parseDiagnostics(readFileSync(fromFile, 'utf8'));
      if (parsed.unparsed.length) {
        throw new Error(`the transcript carries ${parsed.unparsed.length} line(s) this screen cannot parse: ${parsed.unparsed[0]}`);
      }
      diagnostics = parsed.diagnostics;
    } else {
      diagnostics = typecheck(root);
    }
  } catch (e) {
    console.error(`[check-scripts-typecheck] ${e.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = run(root, diagnostics);
  } catch (e) {
    console.error(`[check-scripts-typecheck] ${e.message}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify({ root, ...result }));
  } else if (result.ok) {
    console.log(
      `[check-scripts-typecheck] OK — ${result.errors} type error(s) across ${result.files} script file(s), ` +
        `every one recorded in ${BASELINE_REL} (floor ${result.baselined}).`,
    );
  } else {
    if (result.findings.length) {
      console.error(`\n✖ ${result.findings.length} new type error(s) in scripts/** — the directory is type-checked (#3413):`);
      for (const f of result.findings) console.error(`    - ${f.file}(${f.line}): ${f.code}: ${f.message}`);
      console.error('\n  Fix the script, or — only for an error this screen genuinely cannot avoid — re-cut');
      console.error(`  ${BASELINE_REL}. The floor is shrink-only, so an entry may only get smaller.`);
    }
    if (result.stale.length) {
      console.error(`\n✖ ${result.stale.length} baselined type error(s) thinned out — lower the floor (#3413):`);
      for (const s of result.stale) {
        console.error(`    - ${s.file} ${s.code}: ${s.actual} seen, ${s.expected} baselined — ${s.message}`);
      }
      console.error('  Delete or shrink that entry the day the fix lands; an exemption cannot outlive its code.');
    }
    process.exit(1);
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && process.argv[1].includes('check-scripts-typecheck')) main();
