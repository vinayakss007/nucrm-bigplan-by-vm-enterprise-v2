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
 * Scope notes, all deliberate:
 *   - A citation whose *path* matches no tracked file is skipped, not failed: the
 *     register also cites vendored (`next/dist/...`), generated (`_06uykto._.js`)
 *     and container-absolute paths. The count and list are printed so a mass
 *     "file was renamed under the register" event stays visible.
 *   - A citation is `drifted` only when every candidate is blank or out-of-range.
 *     Suffix matching means `pool.ts:233` resolves against `lib/db/pool.ts`; if two
 *     tracked files end with the same path fragment, one live target is enough.
 *   - A citation minted inside an HTML comment FAILS, with no allowlist escape. Liveness
 *     is the wrong question there: a comment records a correction, and `CITE_RE` reads
 *     its tokens as claims — so a hand-written comment can grow the resolved set without
 *     anyone asserting anything. Record the number as prose ("line 159") instead.
 *
 * What this guard cannot see, and #2433's dated comment says so at length: a pointer
 * that lands on a NON-BLANK line describing something else is a live citation as far as
 * this file is concerned. Measured across 17 real drifts found by comparing cited
 * content against the commit that wrote the register line, liveness caught 1 — the one
 * whose new target happened to be blank.
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

/**
 * Per-character mask: 1 where the character sits inside an `<!-- … -->` span.
 * This walks characters rather than lines because the boundary case is the whole
 * point — a token on the line that CLOSES a comment is prose if it comes after
 * the `-->`, and a comment if it comes before. Nothing else in this file makes
 * that distinction, and the register's correction comments run long.
 */
export function commentMask(text) {
  const mask = new Uint8Array(text.length);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const opens = text.startsWith('<!--', i);
    const closes = !opens && text.startsWith('-->', i);
    if (opens) depth += 1;
    else if (closes) depth = Math.max(0, depth - 1);
    mask[i] = depth > 0 ? 1 : 0;
    if (opens) i += 3;
    else if (closes) i += 2;
  }
  return mask;
}

/**
 * Citations minted INSIDE an HTML comment. The register's convention is that a dated
 * correction comment records coordinates as prose ("line 159"), never `path:line`,
 * because `CITE_RE` cannot tell a record about a coordinate from a claim about one:
 * every token minted here silently joins the set the guard resolves and the tally it
 * prints. Measured on the first such comment written by hand — 12 tokens, all of them
 * resolving, none of them a claim anyone reviewed.
 */
export function extractCommentCitations(lines) {
  const text = lines.join('\n');
  const mask = commentMask(text);
  const re = new RegExp(CITE_RE.source, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].indexOf(m[1]);
    if (!mask[start]) continue;
    out.push({
      regLine: text.slice(0, m.index).split('\n').length,
      path: m[1],
      n: Number(m[2]),
      cite: `${m[1]}:${m[2]}`,
    });
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

const COMMENT_NOTE =
  '\n  There is no allowlist for this, deliberately. A comment is a record of what\n' +
  '  was corrected, not a claim about a file, and `CITE_RE` cannot tell the two\n' +
  '  apart — every token minted inside `<!-- -->` is a citation as far as this\n' +
  '  guard is concerned, and a silent addition to the set it reports as resolved.\n' +
  '  Write the number as prose ("line 159", "148 → 159"), which is what the\n' +
  '  register already does, or move the citation into the body text where a\n' +
  '  reviewer can see it asserting something.\n';

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
  const commentCites = extractCommentCitations(lines);

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
      (commentCites.length ? `, ${commentCites.length} minted inside a comment` : '') +
      `.`,
  );
  if (skipped.size > 0) {
    console.log(
      `  skipped: ${[...skipped.keys()].slice(0, 12).join(', ')}${skipped.size > 12 ? `, +${skipped.size - 12} more` : ''}`,
    );
  }

  if (commentCites.length > 0) {
    console.error(
      `\n\u001b[31m\u2716 register comment guard failed (#2416 follow-up).\u001b[0m\n` +
        `\n  ${commentCites.length} citation-shaped token(s) in ${args.register} sit inside an HTML\n` +
        `  comment. The tally above already counted them as citations, which is the\n` +
        `  problem: a comment records a correction, and nothing about these was\n` +
        `  reviewed as a claim about a file.\n\n` +
        commentCites.map((c) => `    - reg:${c.regLine}  ${c.cite}`).join('\n') +
        COMMENT_NOTE,
    );
    process.exit(1);
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
  console.log(`[check-register-coords] OK — no drifted coordinates, none minted inside a comment.`);
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
