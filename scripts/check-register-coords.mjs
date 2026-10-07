/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Register coordinate guard (#2416 follow-up).
 *
 * Problem: `docs/infra/PREPROD-ISSUE-REGISTER.md` cites other files as `path:line`.
 * Those files change, the numbers do not, and the sentence keeps reading as evidence
 * while pointing at a blank line — the PP-058 `deploy.yml:298` bug, shipped and
 * believed for weeks. #2416 corrected four of them by hand. Hand corrections decay
 * at exactly the rate the cited files move, so this guard makes the drift blocking
 * using the same baseline-ratchet pattern as `guard:audit` (#2301):
 *   - every `path:N` citation in the register must resolve to a NON-BLANK, in-range
 *     line of a tracked file,
 *   - drift that is already known and has a PR in flight is listed with a written
 *     `reason` in scripts/register-coords-allowlist.json,
 *   - a NEW drift fails CI,
 *   - allowlist entries that no longer drift are reported as STALE (non-failing) so
 *     the file decays honestly.
 *
 * Scope notes, both deliberate:
 *   - A citation whose *path* matches no tracked file is skipped, not failed: the
 *     register also cites vendored (`next/dist/...`), generated (`_06uykto._.js`)
 *     and container-absolute paths. The count and list are printed so a mass
 *     "file was renamed under the register" event stays visible.
 *   - A citation is `drifted` only when every candidate is blank or out-of-range.
 *     Suffix matching means `pool.ts:233` resolves against `lib/db/pool.ts`; if two
 *     tracked files end with the same path fragment, one live target is enough.
 *
 * If the register itself is missing or unreadable the guard FAILS CLOSED — a moved
 * or unmounted doc must never read as "all citations verified".
 *
 * Usage:
 *   node scripts/check-register-coords.mjs [--register <file>] [--allow <file>]
 *   node scripts/check-register-coords.mjs --update   # rewrite the allowlist from live drift
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

export const DEFAULT_REGISTER_PATH = 'docs/infra/PREPROD-ISSUE-REGISTER.md';
export const DEFAULT_ALLOWLIST_PATH = 'scripts/register-coords-allowlist.json';

/** `path.ext:N` — brackets are in the class so `app/api/x/[id]/route.ts:12` is a citation. */
export const CITE_RE =
  /(?:^|[^A-Za-z0-9_./[\]-])([\w./-]+(?:\[[^\]/]+\])?[\w./-]*\.(?:ts|mts|js|mjs|cjs|tsx|json|yml|yaml|sql|md|sh)):(\d+)/g;

export function parseArgs(argv) {
  const args = { register: DEFAULT_REGISTER_PATH, allow: DEFAULT_ALLOWLIST_PATH, update: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--register') args.register = argv[++i];
    else if (a === '--allow') args.allow = argv[++i];
    else if (a === '--update') args.update = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

/** All citations in a register, with the line of the register they sit on. */
export function extractCitations(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(CITE_RE)) {
      out.push({ regLine: i + 1, path: m[1], n: Number(m[2]), cite: `${m[1]}:${m[2]}` });
    }
  }
  return out;
}

/** Exact hit wins; otherwise any tracked file ending with `/path` (prose writes `pool.ts:233`). */
export function resolvePath(tracked, path) {
  if (tracked.includes(path)) return [path];
  return tracked.filter((f) => f.endsWith(`/${path}`) || f === path);
}

const lineAt = (text, n) => {
  const rows = text.split('\n');
  if (n < 1 || n > rows.length) return null;
  return rows[n - 1];
};

/**
 * Core delta. `readFile` maps a tracked path to its contents (null when the file is
 * not present in the working tree). Returns drifted (fatal unless allowlisted),
 * allowed (drift suppressed by the allowlist), stale (allowlist entries that no
 * longer drift) and the skipped-path inventory.
 */
export function computeCoordDelta({ lines, tracked, readFile }) {
  const citations = extractCitations(lines);
  const cache = new Map();
  const textOf = (p) => {
    if (!cache.has(p)) cache.set(p, readFile(p));
    return cache.get(p);
  };

  const drifted = [];
  const skipped = new Map();
  let checked = 0;

  for (const c of citations) {
    const cands = resolvePath(tracked, c.path);
    if (cands.length === 0) {
      skipped.set(c.cite, (skipped.get(c.cite) || 0) + 1);
      continue;
    }
    checked++;
    const probes = cands.map((p) => {
      const text = textOf(p);
      if (text === null) return { ok: false, detail: `${p} is not in the working tree` };
      const row = lineAt(text, c.n);
      if (row === null) {
        return { ok: false, detail: `${p} has ${text.split('\n').length} lines, so :${c.n} is out of range` };
      }
      return { ok: row.trim() !== '', detail: `${p}:${c.n} is ${row.trim() === '' ? 'BLANK' : 'ok'}` };
    });
    if (probes.some((x) => x.ok)) continue;
    drifted.push({ ...c, why: probes.map((x) => x.detail).join('; ') });
  }
  return { checked, total: citations.length, drifted, skipped };
}

export function applyAllowlist(drifted, allowEntries) {
  const allowedKeys = new Set(allowEntries.map((e) => e.cite));
  const driftedKeys = new Set(drifted.map((d) => d.cite));
  return {
    fatal: drifted.filter((d) => !allowedKeys.has(d.cite)),
    suppressed: drifted.filter((d) => allowedKeys.has(d.cite)),
    stale: [...allowedKeys].filter((k) => !driftedKeys.has(k)),
  };
}

function trackedFiles(cwd) {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd }).split('\n').filter(Boolean);
}

const KEY_NOTE =
  '\n  A citation is only as good as the file it points into. Fix the register text\n' +
  '  (correct the coordinate against the current tree, and keep the superseded value\n' +
  '  in the dated correction comment as #2416 does) — or, only if the drift is\n' +
  '  genuinely waiting on another PR, add an entry with a written `reason` to\n' +
  `  ${DEFAULT_ALLOWLIST_PATH} in a reviewed PR.\n`;

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`[check-register-coords] ${e.message}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(
      'usage: node scripts/check-register-coords.mjs [--register <file>] [--allow <file>] [--update]',
    );
    return;
  }

  // FAIL CLOSED on the doc itself: no register means zero checked citations, which
  // would otherwise print as a clean pass.
  if (!existsSync(args.register)) {
    console.error(
      `[check-register-coords] ${args.register} is missing — failing closed (a moved doc is not a verified doc).`,
    );
    process.exit(1);
  }
  let lines;
  try {
    lines = readFileSync(args.register, 'utf8').split('\n');
  } catch (e) {
    console.error(`[check-register-coords] could not read ${args.register} — failing closed: ${e.message}`);
    process.exit(1);
  }

  let tracked;
  try {
    tracked = trackedFiles('.');
  } catch (e) {
    console.error(`[check-register-coords] git ls-files failed — failing closed: ${e.message}`);
    process.exit(1);
  }

  const { checked, total, drifted, skipped } = computeCoordDelta({
    lines,
    tracked,
    readFile: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
  });

  let allow = { entries: [] };
  if (existsSync(args.allow)) {
    try {
      allow = JSON.parse(readFileSync(args.allow, 'utf8'));
    } catch {
      console.error(`[check-register-coords] could not parse ${args.allow} — failing closed.`);
      process.exit(1);
    }
  }

  if (args.update) {
    const old = new Map((allow.entries || []).map((e) => [e.cite, e]));
    const entries = drifted
      .map((d) => ({
        cite: d.cite,
        reason: old.get(d.cite)?.reason || 'TODO: justify — which PR corrects this coordinate?',
      }))
      .sort((a, b) => a.cite.localeCompare(b.cite));
    writeFileSync(
      args.allow,
      JSON.stringify(
        {
          _comment:
            'Known-drifting register coordinates, each with a written `reason` naming the PR that ' +
            'corrects it. The guard FAILS on any drift not listed here and hints when an entry goes ' +
            'stale (prune it). Regenerate preserving reasons: node scripts/check-register-coords.mjs --update',
          entries,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`[check-register-coords] allowlist regenerated: ${entries.length} entries -> ${args.allow}`);
    return;
  }

  const { fatal, suppressed, stale } = applyAllowlist(drifted, allow.entries || []);

  console.log(
    `[check-register-coords] ${checked}/${total} citations resolve against the tracked tree ` +
      `(${skipped.size} unmatchable prose path(s) skipped)` +
      (suppressed.length ? `, ${suppressed.length} allowlisted` : '') +
      `.`,
  );
  if (skipped.size > 0) {
    console.log(
      `  skipped: ${[...skipped.keys()].slice(0, 12).join(', ')}${skipped.size > 12 ? `, +${skipped.size - 12} more` : ''}`,
    );
  }
  if (stale.length > 0) {
    console.log(
      `[check-register-coords] NOTE (non-failing): ${stale.length} allowlisted coordinate(s) no longer drift — prune ${args.allow}:\n` +
        stale.map((f) => `    - ${f}`).join('\n'),
    );
  }

  if (fatal.length > 0) {
    console.error(
      `\n\u001b[31m\u2716 register coordinate guard failed (#2416 follow-up).\u001b[0m\n` +
        `\n  ${fatal.length} citation(s) in ${args.register} point at a blank or out-of-range line:\n\n` +
        fatal.map((d) => `    - reg:${d.regLine}  ${d.cite}  →  ${d.why}`).join('\n') +
        KEY_NOTE,
    );
    process.exit(1);
  }
  console.log(`[check-register-coords] OK — no drifted coordinates.`);
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
