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
 *     line of a tracked file, and every `path:"key"` citation (#3201) to exactly one
 *     key held by that file's JSON object,
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
 *   - A citation is `drifted` only when EVERY candidate fails it — blank or out-of-range
 *     for a `path:N`, missing / ambiguous / non-JSON / unparsable for a `path:"key"`.
 *     Suffix matching means `pool.ts:233` resolves against `lib/db/pool.ts`; if two
 *     tracked files end with the same path fragment, one live target is enough.
 *   - A citation minted inside an HTML comment FAILS, with no allowlist escape. Liveness
 *     is the wrong question there: a comment records a correction, and `CITE_RE` reads
 *     its tokens as claims — so a hand-written comment can grow the resolved set without
 *     anyone asserting anything. Record the number as prose ("line 159") instead.
 *
 * Two citation forms (#3201), and the second one exists because the first is fragile:
 *   - `path:N` — POSITIONAL. Liveness asks whether line N of that file is non-blank.
 *   - `path:"key"` — KEYED. Liveness asks whether that key exists in the file's JSON
 *     object, which it can answer without a line number. `N` moves when anybody inserts
 *     a line above it; `"key"` moves only when the key itself is renamed or deleted,
 *     which is the event the sentence was ever about. Measured on `package.json`: the one
 *     script line **#3178** added at `:65` moved six register pointers that described
 *     nothing which had changed (`guard:cron-lock`, `db:deploy-migrate`, `db:drift-check`,
 *     `guard:catch-empty`, `guard:panel-error-state` twice).
 *   - The keyed form resolves by walking the parsed JSON and collecting every occurrence
 *     of the named key. Zero occurrences is drift ("no such key"). More than one is drift
 *     too ("ambiguous"), NOT a best guess: a pointer that could land on two different
 *     values is not evidence. A non-`.json` target is drift as well rather than a silent
 *     skip, so `foo.ts:"bar"` cannot hide.
 *   - Positional citations are untouched by any of this: same regex pass, same candidate
 *     set, same blank/out-of-range probes, same counts. `guard:coords` measured
 *     463/468 resolvable with 5 unmatchable prose paths at `c38b5deb` before any pointer
 *     was keyed, and the keyed pointers are counted in the same two numbers after.
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

/**
 * `path.ext:N` and — since #3201 — `path.ext:"key"`. Brackets are in the path class so
 * `app/api/x/[id]/route.ts:12` is one citation. The value is an alternation, never a
 * union of characters: group 2 is a line number, group 3 is a key name, and exactly one
 * of them is set. `[^"\s]` in the key class keeps a quoted key on its own line — a key
 * spanning a newline would let `.json:` at the end of one sentence borrow a quote from
 * the next.
 */
export const CITE_RE =
  /(?:^|[^A-Za-z0-9_./[\]-])([\w./-]+(?:\[[^\]/]+\])?[\w./-]*\.(?:ts|mts|js|mjs|cjs|tsx|json|yml|yaml|sql|md|sh)):(?:(\d+)|"([^"\s]{1,120})")/g;

/** Extensions that actually have keys to look up. */
const KEYED_EXT_RE = /\.json$/i;

/**
 * One citation, in whichever form it was written. `kind` is the discriminator every
 * consumer branches on; `n` stays `null` and `key` stays `null` for the other form so a
 * reader cannot mistake one for the other (`Number(null)` is `0`, which is why the keyed
 * form must not smuggle a line number through the positional path).
 */
export function makeCitation(regLine, path, n, key) {
  if (key === undefined || key === '') {
    return { regLine, path, n: Number(n), key: null, kind: 'line', cite: `${path}:${n}` };
  }
  return { regLine, path, n: null, key, kind: 'key', cite: `${path}:"${key}"` };
}

/** The identity an allowlist entry is matched on; positional cites are byte-exact as before. */
export function canonicalCite(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry) return null;
  if (typeof entry.cite === 'string' && entry.cite !== '') return entry.cite;
  if (typeof entry.path === 'string' && typeof entry.key === 'string') return `${entry.path}:"${entry.key}"`;
  return null;
}

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

/** All citations in a register, with the line of the register they sit on. Both forms. */
export function extractCitations(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(CITE_RE)) {
      out.push(makeCitation(i + 1, m[1], m[2], m[3]));
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
 * correction comment records coordinates as prose ("line 159"), never `path:line` and —
 * since #3201 — never `path:"key"`, because `CITE_RE` cannot tell a record about a
 * coordinate from a claim about one: every token minted here silently joins the set the
 * guard resolves and the tally it prints. Measured on the first such comment written by
 * hand — 12 tokens, all of them resolving, none of them a claim anyone reviewed.
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
    out.push({ ...makeCitation(text.slice(0, m.index).split('\n').length, m[1], m[2], m[3]) });
  }
  return out;
}

/**
 * Exact hit wins; otherwise any tracked file ending with `/path` (prose writes `pool.ts:233`).
 *
 * `kind` (#3201) only narrows, never widens: a KEYED citation is about a JSON object, so
 * where a bare `pool.json` has both a `.json` and a `.ts` twin, only the `.json` is probed
 * — the `.ts` twin cannot answer a key question. If no twin is keyed-citable the full
 * candidate set is returned anyway, so the caller fails the pointer out loud instead of
 * counting it as one of the unmatchable prose paths the guard skips by design.
 */
export function resolvePath(tracked, path, kind = 'line') {
  const cands = tracked.includes(path) ? [path] : tracked.filter((f) => f.endsWith(`/${path}`) || f === path);
  if (kind !== 'key') return cands;
  const keyed = cands.filter((f) => KEYED_EXT_RE.test(f));
  return keyed.length > 0 ? keyed : cands;
}

/**
 * The keyed resolver. Walks the parsed document and collects EVERY occurrence of `key`
 * (a name may legitimately repeat across sibling objects, and a pointer that cannot say
 * which one it means is not evidence). Returns a discriminated result rather than
 * throwing, so one bad pointer cannot abort the pass over the other 460.
 *
 * `value` is the string value verbatim, or `JSON.stringify` of a non-string one — a whole
 * subtree compared as one snapshot, so drift inside an array or object the pointer names
 * is caught rather than averaged away.
 */
export function resolveJsonKey(text, path, key) {
  if (!KEYED_EXT_RE.test(path)) {
    return { ok: false, status: 'not-json', value: null, detail: `${path} is not a .json file, so it has no "${key}" key to look up` };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, status: 'parse-error', value: null, detail: `${path} is not valid JSON (${String(e.message).split('\n')[0]})` };
  }
  const hits = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === key) hits.push(v);
        walk(v);
      }
    }
  };
  walk(doc);
  if (hits.length === 0) {
    return { ok: false, status: 'missing', value: null, detail: `${path} has no "${key}" key` };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      status: 'ambiguous',
      value: null,
      detail: `"${key}" appears ${hits.length} times in ${path}, so the pointer does not name one value`,
    };
  }
  const raw = hits[0];
  return { ok: true, status: 'ok', value: typeof raw === 'string' ? raw : JSON.stringify(raw), detail: `${path}:"${key}" exists` };
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
 *
 * Both citation forms are counted into the same `total`/`checked` numbers, so keying a
 * pointer moves nothing in the tally — only the question asked of it. A keyed pointer is
 * `drifted` when the key is absent, duplicated, unparseable or pointed at a non-JSON
 * file; a positional pointer is scored exactly as it was before #3201.
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
  let keyed = 0;

  for (const c of citations) {
    const cands = resolvePath(tracked, c.path, c.kind);
    if (cands.length === 0) {
      skipped.set(c.cite, (skipped.get(c.cite) || 0) + 1);
      continue;
    }
    checked++;
    if (c.kind === 'key') keyed++;
    const probes = cands.map((p) => {
      const text = textOf(p);
      if (text === null) return { ok: false, detail: `${p} is not in the working tree` };
      if (c.kind === 'key') {
        const r = resolveJsonKey(text, p, c.key);
        return { ok: r.ok, detail: r.detail };
      }
      const row = lineAt(text, c.n);
      if (row === null) {
        return { ok: false, detail: `${p} has ${text.split('\n').length} lines, so :${c.n} is out of range` };
      }
      return { ok: row.trim() !== '', detail: `${p}:${c.n} is ${row.trim() === '' ? 'BLANK' : 'ok'}` };
    });
    if (probes.some((x) => x.ok)) continue;
    drifted.push({ ...c, why: probes.map((x) => x.detail).join('; ') });
  }
  return { checked, total: citations.length, keyed, drifted, skipped };
}

/**
 * Splits drifted pointers into fatal / suppressed, and reports allowlist entries that no
 * longer correspond to any drift.
 *
 * Matching is on the canonical `cite` and it is form-sensitive, deliberately: an entry
 * written for `package.json:110` does NOT silence `package.json:"db:drift-check"`, because
 * those two entries describe different claims and the keyed one failing is the whole point
 * of keying it. An entry may be written as `{ "path": …, "key": … }` instead of `{ "cite":
 * … }`, and either way a positional entry stays byte-identical to what this function
 * matched before #3201.
 */
export function applyAllowlist(drifted, allowEntries) {
  const allowedKeys = new Set(allowEntries.map(canonicalCite).filter(Boolean));
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
  `  ${DEFAULT_ALLOWLIST_PATH} in a reviewed PR.\n` +
  '\n  If the pointer names something that has a KEY — a `package.json` script, any\n' +
  '  JSON object member — cite the key instead of the line (`package.json:"db:drift-check"`).\n' +
  '  A line pointer there is re-pinned by other people\'s edits above it; a key pointer is\n' +
  '  only moved by the rename or deletion it is actually about. #3201.\n';

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

  const { checked, total, keyed, drifted, skipped } = computeCoordDelta({
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
      (keyed ? `, ${keyed} resolved by JSON key rather than line number` : '') +
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
        `\n  ${fatal.length} citation(s) in ${args.register} point at a blank or out-of-range line,\n` +
        `  or at a JSON key that is absent, duplicated or held by a non-JSON file:\n\n` +
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
