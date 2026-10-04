/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Semgrep SAST baseline ratchet (#2301).
 *
 * Problem: the Semgrep step in ci.yml ran with `continue-on-error: true`, so
 * SAST findings never failed the build — the "Security Scan (SAST)" job was
 * green no matter what the scanner reported.
 *
 * Fix: the scan itself is blocking (no continue-on-error), and its SARIF output
 * is diffed against scripts/semgrep-baseline.json with the same ratchet pattern
 * as guard:rls / guard:chain / guard:audit:
 *   - a finding keyed by `ruleId::file` (with per-key occurrence count) that is
 *     NOT in the baseline, or EXCEEDS the baseline count, fails CI;
 *   - baseline entries that no longer reproduce are reported as STALE
 *     (non-failing) so the file decays honestly;
 *   - a missing/unparseable SARIF fails CLOSED — a scan that did not run must
 *     never read as green.
 *
 * Granularity note: occurrences of the SAME rule inside the SAME already-
 * baselined file beyond `count` DO fail the guard. Only same-file same-rule
 * findings at or below the recorded count are tolerated; anything in a new file
 * (including a test fixture) is always new.
 *
 * Usage:
 *   node scripts/check-semgrep-baseline.mjs [semgrep.sarif] [--baseline <file>]
 *   node scripts/check-semgrep-baseline.mjs semgrep.sarif --update  # regenerate, keeping reasons
 * Local: produce the SARIF first, exactly like CI does — see the
 * "Run Semgrep SAST" step in .github/workflows/ci.yml.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import process from 'node:process';

export const DEFAULT_BASELINE_PATH = 'scripts/semgrep-baseline.json';

/** Normalize a SARIF artifact URI to a repo-relative POSIX path. */
export function normalizeUri(uri) {
  return String(uri || '')
    .replace(/\\/g, '/')
    .replace(/^\/src\//, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

/**
 * Extract `{ "ruleId::path": count }` from a Semgrep SARIF document.
 */
export function collectSemgrepFindings(sarif) {
  const counts = new Map();
  const runs = Array.isArray(sarif && sarif.runs) ? sarif.runs : null;
  if (!runs) throw new Error('SARIF document has no runs[] — scan did not complete');
  for (const run of runs) {
    for (const res of run.results || []) {
      const rule = res.ruleId || (res.rule && res.rule.id) || 'unknown-rule';
      const uri = normalizeUri(res.locations?.[0]?.physicalLocation?.artifactLocation?.uri);
      const key = `${rule}::${uri}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Core delta logic against a baseline of
 * `{ entries: [{ rule, path, count, reason }] }`.
 * Returns { newKeys: [ {key, live, baseline} ], stale, ok }.
 */
export function computeSemgrepDelta(counts, baseline) {
  const entries = (baseline && baseline.entries) || [];
  const byKey = new Map(entries.map((e) => [`${e.rule}::${e.path}`, e]));
  const newKeys = [];
  for (const [key, live] of counts) {
    const b = byKey.get(key);
    const allowed = b ? Number(b.count || 1) : 0;
    if (live > allowed) newKeys.push({ key, live, baseline: allowed });
  }
  const stale = entries
    .filter((e) => !counts.has(`${e.rule}::${e.path}`))
    .map((e) => `${e.rule}::${e.path}`);
  return { newKeys, stale, ok: newKeys.length === 0 };
}

function parseArgs(argv) {
  const args = { sarif: 'semgrep.sarif', baseline: DEFAULT_BASELINE_PATH, update: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline') args.baseline = argv[++i];
    else if (argv[i] === '--update') args.update = true;
    else rest.push(argv[i]);
  }
  if (rest[0]) args.sarif = rest[0];
  return args;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (!existsSync(args.sarif)) {
    // FAIL CLOSED: no SARIF means the scan did not run (or did not finish).
    console.error(
      `[check-semgrep-baseline] ${args.sarif} not found — the Semgrep scan must produce SARIF before this guard runs (see ci.yml). Failing closed.`,
    );
    process.exit(1);
  }
  let sarif;
  try {
    sarif = JSON.parse(readFileSync(args.sarif, 'utf8'));
  } catch (e) {
    console.error(`[check-semgrep-baseline] could not parse ${args.sarif} as SARIF JSON — failing closed. ${e.message}`);
    process.exit(1);
  }

  let counts;
  try {
    counts = collectSemgrepFindings(sarif);
  } catch (e) {
    console.error(`[check-semgrep-baseline] invalid SARIF — failing closed. ${e.message}`);
    process.exit(1);
  }

  let baseline = { entries: [] };
  if (existsSync(args.baseline)) {
    try {
      baseline = JSON.parse(readFileSync(args.baseline, 'utf8'));
    } catch {
      console.error(`[check-semgrep-baseline] could not parse ${args.baseline} — failing closed.`);
      process.exit(1);
    }
  }

  if (args.update) {
    const old = new Map(((baseline && baseline.entries) || []).map((e) => [`${e.rule}::${e.path}`, e]));
    const entries = [...counts.entries()]
      .map(([key, count]) => {
        const idx = key.indexOf('::');
        const rule = key.slice(0, idx);
        const path = key.slice(idx + 2);
        return old.get(key)
          ? { rule, path, count, reason: old.get(key).reason }
          : { rule, path, count, reason: 'TODO: justify — pre-existing finding at ratchet introduction (#2301)' };
      })
      .sort((a, b) => `${a.rule}::${a.path}`.localeCompare(`${b.rule}::${b.path}`));
    writeFileSync(
      args.baseline,
      JSON.stringify(
        {
          _comment:
            '#2301 grandfathered Semgrep findings, keyed ruleId::file with occurrence count. ' +
            'A finding in a NEW file, a new rule, or MORE occurrences than `count` FAILS CI. ' +
            'Each entry needs a written `reason`. Prune entries as files get fixed. ' +
            'Regenerate preserving reasons: node scripts/check-semgrep-baseline.mjs semgrep.sarif --update',
          entries,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`[check-semgrep-baseline] baseline regenerated: ${entries.length} entries -> ${args.baseline}`);
    return;
  }

  const { newKeys, stale, ok } = computeSemgrepDelta(counts, baseline);

  if (stale.length > 0) {
    console.log(
      `[check-semgrep-baseline] NOTE (non-failing): ${stale.length} baseline entr(y/ies) no longer reproduce — prune ${args.baseline}:\n` +
        stale.map((f) => `    - ${f}`).join('\n'),
    );
  }

  if (!ok) {
    console.error(
      '\n\u001b[31m\u2716 Semgrep baseline guard failed (#2301).\u001b[0m\n' +
        `\n  NEW SAST findings not covered by ${args.baseline} (new file, new rule, or count above baseline):\n\n` +
        newKeys.map((k) => `    - ${k.key}  (${k.live} occurrence(s), baseline allows ${k.baseline})`).join('\n') +
        '\n\n  Fix the pattern, or — only if it is genuinely accepted — add an explicit entry\n' +
        '  with a written `reason` in a reviewed PR. Do NOT re-add `continue-on-error`.\n',
    );
    process.exit(1);
  }

  let total = 0;
  for (const c of counts.values()) total += c;
  console.log(
    `[check-semgrep-baseline] OK — ${total} finding occurrence(s) across ${counts.size} rule/file key(s); ` +
      `all covered by baseline (${((baseline && baseline.entries) || []).length} entries).`,
  );
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
