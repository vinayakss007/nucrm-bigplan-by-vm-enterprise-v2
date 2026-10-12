/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * npm-audit HIGH/CRITICAL baseline ratchet (#2301).
 *
 * Problem: `npm audit --audit-level=high` ran with `continue-on-error: true` in
 * CI, so HIGH dependency CVEs shipped on a green build — "CI blocks known-high
 * vulns" was a false answer on security questionnaires.
 *
 * Fix: this guard makes the audit blocking using the same baseline-ratchet
 * pattern as `guard:rls` / `guard:chain` / `guard:csrf`:
 *   - scripts/audit-baseline.json grandfathers the advisories that already
 *     exist today (each entry carries a `reason`).
 *   - A NEW HIGH/CRITICAL advisory (GHSA id not in the baseline) fails CI.
 *   - Baseline entries that no longer reproduce are reported as STALE
 *     (advisory note only, non-failing) so the file decays honestly.
 *
 * Input: `npm audit --audit-level=high --json` output, read from (in order):
 *   1. --input <file>            (explicit JSON file)
 *   2. stdin (when not a TTY)    (CI: `npm audit --json | node scripts/check-audit-baseline.mjs`)
 *   3. spawned `npm audit`       (local: `npm run guard:audit`)
 * If the JSON is missing or unparseable the guard FAILS CLOSED — a broken or
 * skipped audit must never look like a pass.
 *
 * Usage:
 *   node scripts/check-audit-baseline.mjs [--input <file>] [--baseline <file>]
 *   node scripts/check-audit-baseline.mjs --update   # regenerate baseline, keeping existing reasons
 */
import { readFileSync, writeFileSync, existsSync, readSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

export const DEFAULT_BASELINE_PATH = 'scripts/audit-baseline.json';

/** Synchronously drain fd 0 (stdin). Handles EAGAIN on non-blocking pipes
 *  (sandboxed runners) by short synchronous sleeps, and EOF by readSync=0. */
function readStdinSync() {
  const chunks = [];
  const buf = Buffer.alloc(1 << 16);
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let eagain = 0;
  for (;;) {
    let bytes;
    try {
      bytes = readSync(0, buf, 0, buf.length, null);
      eagain = 0;
    } catch (e) {
      if (e.code === 'EAGAIN' && eagain < 300) { eagain++; sleep(20); continue; }
      if (e.code === 'EAGAIN') throw new Error('stdin pipe stayed EAGAIN for 6s — audit input missing');
      if (e.code === 'EOF') break;
      throw e;
    }
    if (bytes === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, bytes)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Extract the GHSA id from an npm advisory URL (https://github.com/advisories/GHSA-xxxx-...). */
export function ghsaFromUrl(url) {
  const m = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(String(url || ''));
  return m ? m[0].toUpperCase() : null;
}

const HIGH_SEVERITIES = new Set(['high', 'critical']);

/**
 * Resolve every HIGH/CRITICAL advisory in an `npm audit --json` payload.
 *
 * A package entry with severity high/critical gets its advisories from:
 *   - its own `via` advisory objects that carry a GHSA URL and high/critical severity, and
 *   - recursively, the `via` string dependencies that caused its severity.
 * An entry that is high but yields no attributable GHSA (unexpected) is recorded
 * under the fallback key `pkg:<name> range:<range>` so it cannot slip through.
 *
 * Returns { findings: Array<{ghsa,pkg,range,severity,title}>, unattributed: Array<{pkg,range}> }.
 */
export function collectHighFindings(audit) {
  const vulns = (audit && audit.vulnerabilities) || {};
  const byPkg = new Map(Object.entries(vulns));
  const findings = new Map(); // ghsa -> {ghsa,pkg,range,severity,title}
  const unattributed = new Map(); // fallbackKey -> {pkg,range,fallbackKey}
  const memo = new Map(); // pkg -> count of attributable high advisories in its subtree

  // Returns how many HIGH/CRITICAL advisory keys this package's subtree yields.
  const walk = (name, stack) => {
    const v = byPkg.get(name);
    if (!v || !HIGH_SEVERITIES.has(v.severity)) return 0;
    if (memo.has(name)) return memo.get(name);
    if (stack.has(name)) return 0; // dependency cycle: nothing new on this path
    stack.add(name);
    let attributable = 0;
    for (const via of v.via || []) {
      if (typeof via === 'string') {
        // Severity cascade from a dependency's advisory — attribute to that advisory.
        attributable += walk(via, stack);
        continue;
      }
      // Advisory object: { source, name, dependency, title, url, severity, cwe, range }
      const ghsa = ghsaFromUrl(via.url);
      const sev = String(via.severity || '').toLowerCase();
      if (ghsa && HIGH_SEVERITIES.has(sev)) {
        attributable++;
        findings.set(ghsa, {
          ghsa,
          pkg: via.name || v.name || name,
          range: via.range || v.range || '',
          severity: sev,
          title: via.title || '',
        });
      } else if (!ghsa && HIGH_SEVERITIES.has(sev)) {
        // High advisory without a GHSA URL (rare) — must be baselined explicitly.
        attributable++;
        const key = `pkg:${name} range:${via.range || v.range || ''} title:${via.title || ''}`;
        unattributed.set(key, { pkg: name, range: via.range || v.range || '', fallbackKey: key });
      }
      // Non-high advisory objects on a high parent add no key of their own.
    }
    if (attributable === 0) {
      // HIGH package with no reachable high advisory — fail safe by requiring a key.
      const key = `pkg:${name} range:${v.range || ''}`;
      unattributed.set(key, { pkg: name, range: v.range || '', fallbackKey: key });
      attributable = 1;
    }
    stack.delete(name);
    memo.set(name, attributable);
    return attributable;
  };

  for (const name of byPkg.keys()) walk(name, new Set());
  return { findings: [...findings.values()], unattributed: [...unattributed.values()] };
}

/**
 * Core delta logic. Returns { newKeys, stale, findings, ok }.
 * Baseline shape: { _comment?, entries: [{ ghsa, pkg?, range?, reason, ... }] }.
 * Match key is the GHSA id; `pkg`/`range` are documentation (a moved range for
 * the SAME GHSA is not a new advisory, so it stays matched on ghsa alone).
 */
export function computeAuditDelta(audit, baseline) {
  const { findings, unattributed } = collectHighFindings(audit);
  const entries = (baseline && baseline.entries) || [];
  const baselineKeys = new Set(entries.map((e) => e.ghsa || e.pkg)); // fallback entries key on pkg+range text
  const findingKeys = [...findings.map((f) => f.ghsa), ...unattributed.map((u) => u.fallbackKey)];
  const liveKeySet = new Set(findingKeys);

  const newKeys = findingKeys.filter((k) => !baselineKeys.has(k));
  const stale = [...baselineKeys].filter((k) => !liveKeySet.has(k));
  return { findings, unattributed, newKeys, stale, ok: newKeys.length === 0 };
}

function parseArgs(argv) {
  const args = { input: null, baseline: DEFAULT_BASELINE_PATH, update: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--baseline') args.baseline = argv[++i];
    else if (argv[i] === '--update') args.update = true;
  }
  return args;
}

function runNpmAudit() {
  // The same command CI runs.
  const res = spawnSync('npm', ['audit', '--audit-level=high', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!res.stdout || !res.stdout.trim()) {
    console.error('[check-audit-baseline] `npm audit --json` produced no output (npm error below) — failing closed.');
    console.error(String(res.stderr || '').slice(0, 2000));
    process.exit(1);
  }
  return res.stdout;
}

function readAuditJson(args) {
  if (args.input) {
    return readFileSync(args.input, 'utf8');
  }
  if (!process.stdin.isTTY) {
    try {
      const piped = readStdinSync();
      // An empty pipe means the upstream audit died before writing anything —
      // fall back to running it ourselves rather than fail-parsing ''.
      if (piped.trim()) return piped;
    } catch (e) {
      console.warn(`[check-audit-baseline] could not drain stdin (${e.code || e.message}) — running \`npm audit\` directly`);
      return runNpmAudit();
    }
    console.warn('[check-audit-baseline] stdin pipe was empty — running `npm audit` directly');
    return runNpmAudit();
  }
  // Local invocation with no pipe: run the same command CI runs.
  return runNpmAudit();
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  let audit;
  try {
    audit = JSON.parse(readAuditJson(args));
  } catch (e) {
    // FAIL CLOSED: no/unparseable audit JSON must never read as green.
    console.error(
      '[check-audit-baseline] could not read/parse npm audit JSON — failing closed. ' +
        `Run: npm audit --audit-level=high --json | node ${'scripts/check-audit-baseline.mjs'}\n  ${e.message}`,
    );
    process.exit(1);
  }

  let baseline = { entries: [] };
  if (existsSync(args.baseline)) {
    try {
      baseline = JSON.parse(readFileSync(args.baseline, 'utf8'));
    } catch {
      console.error(`[check-audit-baseline] could not parse ${args.baseline} — failing closed.`);
      process.exit(1);
    }
  }

  const { findings, unattributed, newKeys, stale, ok } = computeAuditDelta(audit, baseline);

  if (args.update) {
    const old = new Map(((baseline && baseline.entries) || []).map((e) => [e.ghsa || e.pkg, e]));
    const entries = [
      ...findings.map((f) => ({
        ...f,
        reason: old.get(f.ghsa)?.reason || 'TODO: justify — grandfathered when the ratchet was introduced',
      })),
      ...unattributed.map((u) => ({
        ghsa: u.fallbackKey,
        pkg: u.pkg,
        range: u.range,
        reason: old.get(u.fallbackKey)?.reason || 'TODO: justify — advisory without GHSA id',
      })),
    ].sort((a, b) => String(a.ghsa).localeCompare(String(b.ghsa)));
    writeFileSync(
      args.baseline,
      JSON.stringify(
        {
          _comment:
            '#2301 grandfathered HIGH/CRITICAL npm advisories. Each entry needs a written `reason`. ' +
            'The guard FAILS on any advisory not listed here and hints when an entry goes stale (prune it). ' +
            'Regenerate preserving reasons: npm audit --audit-level=high --json | node scripts/check-audit-baseline.mjs --update',
          entries,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`[check-audit-baseline] baseline regenerated: ${entries.length} entries -> ${args.baseline}`);
    return;
  }

  const highTotal = audit?.metadata?.vulnerabilities?.high ?? findings.length + unattributed.length;
  if (stale.length > 0) {
    console.log(
      `[check-audit-baseline] NOTE (non-failing): ${stale.length} baseline entr(y/ies) no longer reproduce — prune ${args.baseline}:\n` +
        stale.map((f) => `    - ${f}`).join('\n'),
    );
  }

  if (!ok) {
    console.error(
      '\n\u001b[31m\u2716 npm audit baseline guard failed (#2301).\u001b[0m\n' +
        `\n  NEW HIGH/CRITICAL advisories not present in ${args.baseline}:\n\n` +
        newKeys.map((k) => `    - ${k}`).join('\n') +
        '\n\n  Fix by upgrading the affected dependency (npm audit fix / targeted bump),\n' +
        '  or — only if the advisory is genuinely accepted — add an explicit entry with a\n' +
        '  written `reason` to scripts/audit-baseline.json in a reviewed PR.\n' +
        '  Do NOT re-add `continue-on-error` to the audit step.\n',
    );
    process.exit(1);
  }

  console.log(
    `[check-audit-baseline] OK — ${highTotal} high-severity package finding(s); ` +
      `${findings.length + unattributed.length} advisory key(s) matched, baseline covers them all (${((baseline && baseline.entries) || []).length} entries).`,
  );
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
