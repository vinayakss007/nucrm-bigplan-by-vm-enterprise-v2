/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Scripts typecheck floor (#3413).
 *
 * `tsconfig.json` excludes `scripts/**`, and `next build` only ever reads that
 * file, so the ~60 operator scripts that talk to the database directly were
 * compiled by nothing. The blind spot was not hypothetical when this screen
 * landed: it is how `restore-db.ts` ended up importing `pgSslConfig` three
 * times, and how `migrate.ts` came to call `groupMissingByOwner` without
 * importing it — a ReferenceError waiting in the FATAL path of the one script
 * an operator reaches for when a migration goes wrong.
 *
 * So `scripts/**` now has its own project (`tsconfig.scripts.json`), run by
 * `npm run typecheck`. Type-checking 60 files that no typechecker ever read
 * does not come back clean, and pretending otherwise would mean rewriting the
 * seed scripts in the same PR as the bug they hid. So this screen is a
 * ratchet, not a gate-that-never-fires:
 *
 *  - a file with errors that is NOT in scripts/scripts-typecheck-baseline.json
 *    fails — new code is checked from day one;
 *  - a baselined file that gains errors past its recorded count fails;
 *  - a baselined file that is now clean (or cheaper) prints a hint to lower
 *    the entry, and the entry is dropped when it reaches zero.
 *
 * `--write-baseline` re-records the current set (use it after fixing a file,
 * never to make a failure go away), and `--report <file>` reads tsc output
 * from a file instead of running tsc, so the arithmetic is testable without a
 * compile.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASELINE_PATH = join(HERE, 'scripts-typecheck-baseline.json');
const PROJECT = 'tsconfig.scripts.json';

const ERROR_LINE = /^(.+?\.(?:ts|mts|cts))\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const ANY_ERROR = /\berror TS\d+:/;
const IS_FILE_KEY = /\.(ts|mts|cts)$/;
const BASELINE_NOTE =
  '#3413 floor: operator scripts no typechecker ever read. Each value is that file\'s error count when the floor was cut. ' +
  'The screen fails if a file outside this list gains an error, or if a listed file grows past its number. ' +
  'Lower an entry as you fix a file; delete it when it reaches 0. Re-measure with: node scripts/check-scripts-typecheck.mjs --write-baseline';

function readBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) {
    console.error(`\u001b[31m✖ ${path} is missing — the floor is the screen.\u001b[0m`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return Object.fromEntries(Object.entries(raw).filter(([k]) => IS_FILE_KEY.test(k)));
}

function runTsc() {
  const r = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false', '-p', PROJECT], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    console.error(`\u001b[31m✖ Could not run tsc (${r.error.message}) — failing closed.\u001b[0m`);
    process.exit(1);
  }
  return { text: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status ?? 1 };
}

/** @returns {{ counts: Map<string, number>, unattributed: string[] }} */
function collect(text) {
  const counts = new Map();
  const unattributed = [];
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const m = ERROR_LINE.exec(line);
    if (m) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    } else if (ANY_ERROR.test(line)) {
      unattributed.push(line.trim());
    }
  }
  return { counts, unattributed };
}

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const writeMode = argv.includes('--write-baseline');
const reportAt = argv.indexOf('--report');
const reportPath = reportAt >= 0 ? argv[reportAt + 1] : null;
const statusAt = argv.indexOf('--status');
const baselineAt = argv.indexOf('--baseline');
const baselinePath = baselineAt >= 0 ? argv[baselineAt + 1] : BASELINE_PATH;

const reportText = reportPath ? readFileSync(reportPath, 'utf8') : null;
const source = reportText === null
  ? runTsc()
  : { text: reportText, status: statusAt >= 0 ? Number(argv[statusAt + 1]) : (ANY_ERROR.test(reportText) ? 1 : 0) };
const { counts, unattributed } = collect(source.text);
const status = source.status;

// tsc said it failed but produced nothing attributable: a bad project file, a
// crash, an unparseable config. A screen that reads that as "0 errors" is the
// bug this issue is about.
if (status !== 0 && counts.size === 0) {
  console.error('\u001b[31m✖ tsc exited non-zero without a single file-level error:\u001b[0m');
  console.error(unattributed.slice(0, 10).join('\n') || '(no output at all)');
  process.exit(1);
}

if (writeMode) {
  const next = { _comment: BASELINE_NOTE };
  for (const [file, n] of [...counts.entries()].sort()) next[file] = n;
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`[check-scripts-typecheck] baseline re-recorded: ${counts.size} file(s), ${[...counts.values()].reduce((a, b) => a + b, 0)} error(s).`);
  process.exit(0);
}

const baseline = readBaseline(baselinePath);

const fresh = [...counts.entries()].filter(([file]) => baseline[file] === undefined);
const grown = [...counts.entries()].filter(
  ([file, n]) => baseline[file] !== undefined && n > baseline[file],
);
const shrunk = Object.keys(baseline)
  .filter((file) => baseline[file] > (counts.get(file) ?? 0))
  .map((file) => ({ file, base: baseline[file], now: counts.get(file) ?? 0 }));

if (jsonMode) {
  console.log(JSON.stringify({
    totalErrors: [...counts.values()].reduce((a, b) => a + b, 0),
    filesWithErrors: counts.size,
    baselineFiles: Object.keys(baseline).length,
    baselineErrors: Object.keys(baseline).reduce((a, f) => a + baseline[f], 0),
    fresh, grown, shrunk,
    ok: fresh.length === 0 && grown.length === 0,
  }, null, 2));
  process.exit(fresh.length === 0 && grown.length === 0 ? 0 : 1);
}

if (shrunk.length > 0) {
  console.log(
    `\n\u001b[36mℹ ${shrunk.length} baselined script(s) got cheaper (#3413) — lower or drop the entry to tighten the floor:\u001b[0m\n` +
      shrunk.map((s) => `    - ${s.file} (${s.now} < baseline ${s.base})`).join('\n'),
  );
}

let failed = false;

if (fresh.length > 0) {
  failed = true;
  console.error(
    `\n\u001b[31m✖ Script file(s) with type errors that the floor never heard of (#3413):\u001b[0m\n` +
      fresh.map(([file, n]) => `    - ${file} (${n})`).join('\n') +
      `\n\n  Fix them, or — if this file is new and the errors are inherited,\n` +
      `  not introduced — add it to scripts/scripts-typecheck-baseline.json\n` +
      `  with a justification in review.\n`,
  );
}

if (grown.length > 0) {
  failed = true;
  console.error(
    `\n\u001b[31m✖ Baselined script(s) grew past their type-error floor (#3413):\u001b[0m\n` +
      grown.map(([file, n]) => `    - ${file} (${n} > floor ${baseline[file]})`).join('\n') +
      `\n\n  These files are supposed to shrink, not grow. ` +
      `node scripts/check-scripts-typecheck.mjs --write-baseline is for after a\n` +
      `  fix, not around one.\n`,
  );
}

if (failed) process.exit(1);

if (counts.size > 0) {
  const sorted = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  console.log(
    `[check-scripts-typecheck] Baselined files carrying type errors (see scripts/scripts-typecheck-baseline.json):\n` +
      sorted.map(([file, n]) => `    - ${file}: ${n} (floor: ${baseline[file] ?? n})`).join('\n'),
  );
}

console.log(
  `[check-scripts-typecheck] OK — ${counts.size} script file(s) still carry type errors ` +
    `(${[...counts.values()].reduce((a, b) => a + b, 0)}), all at or under the floor; ` +
    `everything else under scripts/** compiles.`,
);
