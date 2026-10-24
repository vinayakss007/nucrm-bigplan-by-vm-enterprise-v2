/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Register content-drift screen (#2416 follow-up, the check #2433 had to run by hand).
 *
 * `guard:coords` (scripts/check-register-coords.mjs) answers LIVENESS: does `path:N` land on
 * a non-blank, in-range line of a tracked file? Measured across the 25 coordinate pointers
 * this register has actually lost, liveness caught 1 — the one whose new target happened to
 * be blank. The other 24 landed on non-blank lines describing something else, printed
 * "211/216 citations resolve, exit 0", and stayed believed for weeks.
 *
 * This screen answers the question liveness cannot: is the line cited STILL the line that
 * was true when the sentence was written? For every `path:N` citation it finds the commit
 * that authored that register line (`git blame`), reads the cited file at THAT commit and at
 * HEAD, and compares the content of line N. Different content = the pointer moved.
 *
 * Keyed citations (#3201) ask the same question one level closer to what the sentence means.
 * `package.json:"db:drift-check"` has no line number, so there is nothing to relocate: the
 * screen resolves the key in that file's JSON object at the authoring revision and at HEAD
 * and compares the two VALUES. Inserting an unrelated script line above it is invisible to
 * the check — which is the entire point, because that insertion is what made a `path:N`
 * pointer describe a change nobody had made — while renaming or deleting the key is exactly
 * a drift, and a missing key at HEAD fails loudly rather than being counted as unverifiable.
 * Positional citations keep their line-content comparison untouched.
 *
 *   node scripts/check-register-drift.mjs              # exit 1 on un-allowlisted drift
 *   node scripts/check-register-drift.mjs --update     # rewrite the allowlist from live drift
 *
 * Where it runs, and why not in PR CI: it needs the whole history of every cited file, so
 * the checkout must be `fetch-depth: 0` (ci.yml's own checkout is depth 1). Worse than the
 * cost — the answer is branch-dependent. A branch that carries a re-pin and a branch that
 * does not measure different drift for the same cited file, so a `pull_request` gate would
 * go red on perfectly-shaped stacked branches for a reason the author cannot fix. The
 * scheduled job in .github/workflows/nightly-soak.yml measures main, once a night, and that
 * number means what it says.
 *
 * Three things it cannot see, and prints rather than hiding:
 *   - A register line whose last author IS the revision being measured compares to itself and
 *     can only read as unchanged. That is every pointer a squash-merged re-pin PR just wrote,
 *     so the honest number is `same − authored by HEAD`. `git log` on main says how big the
 *     blind spot is tonight; the count is printed.
 *   - A citation whose line was already out of range when it was written has no "then"
 *     content to compare against (and a keyed citation whose key was absent, ambiguous or
 *     unparsable in the file then is the same case). Counted as unverifiable, never as
 *     drift, and `guard:coords` still fails it if it is out of range at HEAD too — a key
 *     that is missing at HEAD is NOT, that one is drift, and it is fatal.
 *   - A citation on a register line that is not committed yet. blame answers those with 40
 *     zeros, so they are counted separately rather than quietly scored: this is the state of
 *     anyone editing a re-pin PR, which is exactly who runs this screen by hand. The blame is
 *     therefore of the working tree, not of `--rev`'s copy — the citations are read off disk
 *     and line numbers only mean what they say if both sides are the same lines.
 *
 * FAILS CLOSED on the environment: no git, no register, a shallow repo or an unparsable
 * blame all exit 1 with the reason. A screen that cannot see history must never report
 * "no drift".
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import {
  DEFAULT_REGISTER_PATH,
  extractCitations,
  resolvePath,
  resolveJsonKey,
  canonicalCite,
} from './check-register-coords.mjs';

export const DEFAULT_DRIFT_ALLOWLIST_PATH = 'scripts/register-drift-allowlist.json';

export function parseDriftArgs(argv) {
  const args = {
    register: DEFAULT_REGISTER_PATH,
    allow: DEFAULT_DRIFT_ALLOWLIST_PATH,
    rev: 'HEAD',
    update: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--register') args.register = argv[++i];
    else if (a === '--allow') args.allow = argv[++i];
    else if (a === '--rev') args.rev = argv[++i];
    else if (a === '--update') args.update = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

/**
 * blame's sentinel for content that exists in the working tree and in no commit yet. Git
 * spells it as 40 zeros; it is a real answer, not a missing one — the line IS new, so no
 * revision can be asked what it meant.
 */
export const UNCOMMITTED_SHA = '0'.repeat(40);

/**
 * `git blame --line-porcelain` → register line number to the sha that last wrote it.
 * A porcelain header is `<sha> <origLine> <finalLine> [numLines]`; the caret that marks a
 * BOUNDARY commit (the oldest commit blame can reach — every root commit, and the shallow
 * tip of a depth-1 clone) prefixes the sha, so it is optional here. Skipping a header is
 * not a neutral mistake: the citation loses its authoring revision and can only be
 * reported as unverifiable, which is how a first draft of this screen quietly lost 35 of
 * 216 pointers. Every header is recorded, last one wins, because a line that moved
 * between files gets an interleaved "previous location" header for the same final line
 * BEFORE the one that actually authored it.
 */
export function parseBlameRevs(porcelain) {
  const map = new Map();
  for (const line of porcelain.split('\n')) {
    const m = line.match(/^\^?([0-9a-f]{40}) (\d+) (\d+)(?: \d+)?$/);
    if (m) map.set(Number(m[3]), m[1]);
  }
  return map;
}

const trimAt = (rows, n) => (rows && n >= 1 && n <= rows.length ? rows[n - 1].trim() : null);

/** `contentAt` hands back lines; a JSON document has to be re-joined to be parsed. */
const joined = (rows) => (rows === null || rows === undefined ? null : rows.join('\n'));

/**
 * What a keyed pointer held at one revision, as a string comparable against the other side.
 * `null` means "this revision cannot answer" — no such key, an ambiguous key, a file that is
 * not JSON, or JSON that does not parse. The caller sorts those into `unverifiable` (when it
 * is the THEN side, which has no fact to compare against) and into `moved` (when it is the
 * NOW side, which is the drift we are looking for).
 */
function keyAt(rows, path, key) {
  if (rows === null) return null;
  const r = resolveJsonKey(joined(rows), path, key);
  return r.ok ? r.value : null;
}

/**
 * The whole measurement, with git injected so it can be tested against fixtures.
 *
 * `trackedAt(rev)` → tracked paths at that rev; `contentAt(rev, path)` → its lines, or null.
 *
 * Categories are exhaustive over the citations `extractCitations` returns:
 *   unresolved   — the path matches no tracked file at HEAD (vendored, generated, container
 *                  absolute: prose a citation-shaped regex cannot tell about)
 *   gone         — no tracked file at HEAD, but there WAS one when the line was written
 *   unverifiable — a file matched at both ends, yet line N did not exist when it was written
 *                  (or, for a keyed pointer, the key was not there to read when it was written)
 *   moved        — line N's content at HEAD is not the content it had when written; for a
 *                  keyed pointer, the key's VALUE differs, or the key is gone
 *   same         — it still is
 * `selfAuthored` counts the `same` whose authoring sha is the measured sha: unchanged by
 * construction, which is a limitation to read, not a pass to celebrate. `uncommitted`
 * counts citations whose register line has no commit yet — blame reports them under
 * `UNCOMMITTED_SHA`, and a line that is not in history has no "then" to compare. Both are
 * the same class of thing: a pointer this screen structurally cannot check, so it is
 * disclosed in the tally instead of absorbed into `same`. `keyed` counts how many of the
 * instances were read by key rather than by line, so the tally says which question was asked.
 */
export function computeDriftDelta({ lines, blame, trackedAt, contentAt, headSha }) {
  const citations = extractCitations(lines);
  const revCache = new Map();
  const tracked = (rev) => {
    if (!revCache.has(rev)) revCache.set(rev, trackedAt(rev));
    return revCache.get(rev);
  };
  const fileCache = new Map();
  const content = (rev, path) => {
    const cacheKey = `${rev}|${path}`;
    if (!fileCache.has(cacheKey)) fileCache.set(cacheKey, contentAt(rev, path));
    return fileCache.get(cacheKey);
  };

  const out = {
    instances: citations.length,
    same: 0,
    selfAuthored: 0,
    uncommitted: 0,
    keyed: 0,
    moved: [],
    unverifiable: [],
    unresolved: [],
    gone: [],
  };

  for (const c of citations) {
    const rev = blame.get(c.regLine) ?? null;
    const nowCands = resolvePath(tracked(headSha), c.path, c.kind);
    if (nowCands.length === 0) {
      if (rev && rev !== UNCOMMITTED_SHA && resolvePath(tracked(rev), c.path, c.kind).length > 0) {
        out.gone.push({ ...c, rev });
        continue;
      }
      out.unresolved.push(c.cite);
      continue;
    }
    if (rev === UNCOMMITTED_SHA) {
      out.uncommitted += 1;
      continue;
    }
    if (!rev) {
      out.unverifiable.push({ ...c, why: 'no blame entry for this register line' });
      continue;
    }
    const thenCands = resolvePath(tracked(rev), c.path, c.kind);
    if (thenCands.length === 0) {
      out.unverifiable.push({ ...c, why: `${c.path} was not tracked at ${rev.slice(0, 8)}` });
      continue;
    }
    if (c.kind === 'key') {
      out.keyed += 1;
      const thenVals = thenCands.map((p) => keyAt(content(rev, p), p, c.key));
      const nowVals = nowCands.map((p) => keyAt(content(headSha, p), p, c.key));
      if (!thenVals.some((x) => x !== null)) {
        out.unverifiable.push({ ...c, why: `"${c.key}" held no readable value at ${rev.slice(0, 8)}` });
        continue;
      }
      if (nowVals.some((x) => x !== null && x !== '' && thenVals.includes(x))) {
        out.same += 1;
        if (rev === headSha) out.selfAuthored += 1;
        continue;
      }
      const why = nowVals.every((x) => x === null)
        ? `the key is not readable in the current tree (absent, ambiguous, or the file does not parse)`
        : `the key's value is not what it was when the sentence was written`;
      out.moved.push({
        ...c,
        rev,
        why,
        then: thenVals.filter((x) => x !== null).slice(0, 2),
        now: nowVals.filter((x) => x !== null).slice(0, 2),
      });
      continue;
    }
    const now = nowCands.map((p) => trimAt(content(headSha, p), c.n));
    const then = thenCands.map((p) => trimAt(content(rev, p), c.n));
    if (!then.some((x) => x !== null)) {
      out.unverifiable.push({ ...c, why: `:${c.n} was out of range when the line was written` });
      continue;
    }
    // A blank "now" is never a match: a pointer that slid onto an empty line is drift,
    // and `guard:coords` reports that one — this screen must not disagree with it.
    if (now.some((x) => x !== null && x !== '' && then.includes(x))) {
      out.same += 1;
      if (rev === headSha) out.selfAuthored += 1;
    } else {
      out.moved.push({ ...c, rev, then: then.filter((x) => x !== null).slice(0, 2), now: now.filter((x) => x !== null).slice(0, 2) });
    }
  }
  return out;
}

/**
 * Same contract as `applyAllowlist` in the coords guard (#3201): matching is on the
 * canonical `cite`, and it is form-sensitive. An entry written for `package.json:110`
 * never silences `package.json:"db:drift-check"` — if a keyed pointer drifts, that means
 * the key was renamed or deleted or its value edited, and the sentence has to be
 * re-read, not hushed.
 */
export function applyDriftAllowlist(moved, allowEntries) {
  const keys = new Set(allowEntries.map(canonicalCite).filter(Boolean));
  const movedKeys = new Set(moved.map((m) => m.cite));
  return {
    fatal: moved.filter((m) => !keys.has(m.cite)),
    suppressed: moved.filter((m) => keys.has(m.cite)),
    stale: [...keys].filter((k) => !movedKeys.has(k)),
  };
}

function git(args, cwd = '.') {
  return execFileSync('git', args, { encoding: 'utf8', cwd, maxBuffer: 64 << 20 });
}

const NOTE =
  '\n  A pointer that still lands on a live line is not a pointer that still says what was\n' +
  '  written. Fix the register (re-pin the coordinate against the current tree and keep the\n' +
  '  superseded number in the dated correction comment, as #2416 does) — or, only when the\n' +
  '  drift is genuinely waiting on another PR, add an entry with a written `reason` to\n' +
  `  ${DEFAULT_DRIFT_ALLOWLIST_PATH} in a reviewed PR.\n` +
  '\n  If this pointer names a JSON object member, keying it is the fix that outlives the\n' +
  '  next re-pin: `package.json:"db:drift-check"` compares the value, so a line inserted\n' +
  '  above it is nothing this screen has to be told about. #3201.\n';

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseDriftArgs(argv);
  } catch (e) {
    console.error(`[check-register-drift] ${e.message}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(
      'usage: node scripts/check-register-drift.mjs [--register <file>] [--allow <file>] [--rev <ref>] [--update]',
    );
    return;
  }

  if (!existsSync(args.register)) {
    console.error(
      `[check-register-drift] ${args.register} is missing — failing closed (a moved doc is not a verified doc).`,
    );
    process.exit(1);
  }
  let lines;
  try {
    lines = readFileSync(args.register, 'utf8').split('\n');
  } catch (e) {
    console.error(`[check-register-drift] could not read ${args.register} — failing closed: ${e.message}`);
    process.exit(1);
  }

  // The screen is a history comparison. Every one of these checks fails CLOSED: a shallow
  // clone silently shrinks `then` to whatever the tip has, which reads as "no drift".
  let shallow = 'true';
  let headSha = '';
  try {
    shallow = git(['rev-parse', '--is-shallow-repository']).trim();
    headSha = git(['rev-parse', args.rev]).trim();
  } catch (e) {
    console.error(`[check-register-drift] git says: ${String(e.message).split('\n')[0]} — failing closed.`);
    process.exit(1);
  }
  if (shallow === 'true') {
    console.error(
      '\n\x1b[31m✖ this checkout is shallow (#2416 follow-up).\x1b[0m\n' +
        '\n  The screen compares each citation against the commit that WROTE it, so it needs\n' +
        '  every ancestor of every cited file. `actions/checkout` fetches depth 1 by default;\n' +
        '  run it with `fetch-depth: 0` (see the job in .github/workflows/nightly-soak.yml).\n' +
        '  Reporting "0 moved" from a tree that cannot see its own history is the failure mode\n' +
        '  this whole file exists to stop.\n',
    );
    process.exit(1);
  }

  let blame;
  try {
    // Blame the WORKING TREE, not `--rev`'s copy: the citations were read off disk, so line
    // numbers only mean what they say if the blame is of those same lines. Asking HEAD's
    // copy instead is the same bug in miniature — a re-pin PR that edits the register and
    // then runs this screen locally gets every later line mapped to the revision before it,
    // and its freshly written pointers are scored as if they had already been checked.
    // Committed lines answer identically; uncommitted ones answer in zeros, counted below.
    blame = parseBlameRevs(git(['blame', '--line-porcelain', '--', args.register]));
  } catch (e) {
    console.error(`[check-register-drift] git blame failed — failing closed: ${String(e.message).split('\n')[0]}`);
    process.exit(1);
  }
  if (blame.size === 0) {
    console.error(
      `[check-register-drift] blame produced no line→sha map for ${args.register} — failing closed (an unparsable blame is not an empty register).`,
    );
    process.exit(1);
  }

  const trackedAt = (rev) => git(['ls-tree', '-r', '--name-only', rev]).split('\n').filter(Boolean);
  const contentAt = (rev, path) => {
    try {
      return git(['show', `${rev}:${path}`]).split('\n');
    } catch {
      return null;
    }
  };

  const d = computeDriftDelta({ lines, blame, trackedAt, contentAt, headSha });

  let allow = { entries: [] };
  if (existsSync(args.allow)) {
    try {
      allow = JSON.parse(readFileSync(args.allow, 'utf8'));
    } catch {
      console.error(`[check-register-drift] could not parse ${args.allow} — failing closed.`);
      process.exit(1);
    }
  }

  if (args.update) {
    const old = new Map((allow.entries || []).map((e) => [e.cite, e]));
    // Group by cite, keeping every register line that points there: `applyDriftAllowlist`
    // matches on cite, so one entry silences several pointers, and a regenerated file that
    // dropped the line list would leave a reviewer no way to tell ONE entry covering two
    // sentences from two drifts that merely share a target.
    const byCite = new Map();
    for (const m of d.moved) {
      const e = byCite.get(m.cite) || { cite: m.cite, regLines: [] };
      if (!e.regLines.includes(m.regLine)) e.regLines.push(m.regLine);
      byCite.set(m.cite, e);
    }
    const entries = [...byCite.values()]
      .map((e) => ({
        ...e,
        reason: old.get(e.cite)?.reason || 'TODO: justify — which PR re-pins this pointer?',
      }))
      .sort((a, b) => a.cite.localeCompare(b.cite));
    writeFileSync(
      args.allow,
      JSON.stringify(
        {
          _comment:
            'Register pointers whose cited LINE CONTENT differs from the revision that wrote them, ' +
            'each with a written `reason` saying which PR re-pins it or why nothing does. The screen ' +
            'FAILS on any drift not listed here and reports entries that no longer drift as STALE ' +
            '(non-failing, prune them). `regLines` are the register sentences the cite silences — ' +
            'the screen matches on cite, so one entry can cover several. Regenerate preserving ' +
            'reasons: node scripts/check-register-drift.mjs --update',
          entries,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`[check-register-drift] allowlist regenerated: ${entries.length} entries -> ${args.allow}`);
    return;
  }

  const { fatal, suppressed, stale } = applyDriftAllowlist(d.moved, allow.entries || []);
  const measured = d.instances - d.unresolved.length;
  console.log(
    `[check-register-drift] at ${headSha.slice(0, 8)}: ${d.instances} citation instances, ` +
      `${measured} resolvable to a tracked file` +
      (d.keyed ? ` (${d.keyed} of them read by JSON key, not line number)` : '') +
      `, ${d.same} still say what was written ` +
      `(${d.selfAuthored} of those were written by this very revision and so cannot be checked against history)` +
      (d.uncommitted
        ? `, plus ${d.uncommitted} on register lines that are not committed yet, which no revision has written and nothing here can check`
        : '') +
      `, ` +
      `${d.moved.length} moved, ${d.unverifiable.length} unverifiable` +
      (d.gone.length ? `, ${d.gone.length} file gone` : '') +
      `, ${d.unresolved.length} path not tracked (prose/vendored)` +
      (suppressed.length ? `; ${suppressed.length} allowlisted` : '') +
      '.',
  );
  for (const u of d.unverifiable) {
    console.log(`  unverifiable: reg:${u.regLine} ${u.cite} — ${u.why}`);
  }
  for (const g of d.gone) {
    console.log(`  file gone: reg:${g.regLine} ${g.cite} — ${g.path} was tracked at ${g.rev.slice(0, 8)}, is not now`);
  }
  if (stale.length > 0) {
    console.log(
      `[check-register-drift] NOTE (non-failing): ${stale.length} allowlisted pointer(s) no longer drift — prune ${args.allow}:\n` +
        stale.map((f) => `    - ${f}`).join('\n'),
    );
  }

  if (fatal.length > 0) {
    console.error(
      `\n\x1b[31m✖ register content drift found (#2416 follow-up).\x1b[0m\n` +
        `\n  ${fatal.length} citation(s) in ${args.register} now point at different CONTENT than the\n` +
        `  revision that wrote them had there — a live line, but the wrong one, which is\n` +
        `  exactly what guard:coords cannot see. For a keyed citation the key's VALUE is that\n` +
        `  content, so "moved" here means renamed, deleted or re-pointed — never "shifted":\n\n` +
        fatal
          .map(
            (m) =>
              `    - reg:${m.regLine}  ${m.cite}  (written at ${m.rev.slice(0, 8)})` +
              (m.why ? `\n        why:  ${m.why}` : '') +
              `\n        then: ${JSON.stringify(m.then[0] ?? '')}\n` +
              `        now:  ${JSON.stringify(m.now[0] ?? '')}`,
          )
          .join('\n') +
        NOTE,
    );
    process.exit(1);
  }
  console.log(`[check-register-drift] OK — every drifted pointer is allowlisted, ${d.moved.length} total.`);
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
