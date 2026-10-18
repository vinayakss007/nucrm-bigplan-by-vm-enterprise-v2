/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Panel error-state ratchet (#2829).
 *
 * The class, in one sentence: a panel reads `{ data, isLoading }` from
 * `useApiQuery`/`useQuery`, never binds the failure, and renders a sentence
 * ABOUT THE TENANT'S DATA ("No API keys yet", "Trash is empty") when the array
 * comes back empty — so a 500, an RLS refusal (42501), a dead pool or a missing
 * column all read as "you have none". #2439 → #2823 → #2825 fixed 9 panels and #2829
 * counted 36 more; this sweep finds 47, because the issue's grep missed JSX text on
 * its own line and did not cover `app/portal/**` (#2825's, and its PR is open). The
 * shape was never the hard part — the missing screen was: nothing in CI noticed,
 * because nothing was asserted.
 *
 * What makes this an actual failure rather than a cosmetic one: five of the 36
 * answer an operational question, and a masked failure reads as an all-clear —
 * `settings/backup` ("No backups yet") tells an operator the tenant was never
 * backed up, `settings/sessions` ("No sessions found") reports nobody signed in
 * on a read that looked at nobody, `settings/api-keys` hides live credentials
 * next to a button inviting a duplicate, `webhooks/dlq` makes the backlog
 * disappear exactly when the endpoint is unhealthy, and `trash` says there is
 * nothing to purge while records past retention are still pending deletion.
 *
 * RATCHET, not a mass fix. A file in the class that is already listed in
 * `scripts/panel-error-state-baseline.json` is tolerated and counted; a NEW one
 * fails CI, with the sentence it renders as the evidence. Fixing a panel drops
 * it out of the class, which prints a hint to delete the baseline entry — the
 * list only ever shrinks. Same shape as `check-file-size.mjs` (#1843/#422).
 *
 * What is deliberately NOT detected (and why):
 *   - `loading` spinners: honest, they do not claim absence.
 *   - `toast.error` / `console.error` / `d.error`: a property named `error` is
 *     not the query's error. Only a binding or reference that this file's own
 *     query call produced counts as "distinguishes failure".
 *   - components under `components/`: this pass scans the `page.tsx` files under
 *     `app/`, where the class lives. Re-measured before shipping: exactly one file
 *     under `components/` issues a query (`components/tenant/product-entry-client.tsx`)
 *     and it renders no anchored absence copy, so widening ROOTS would find nothing
 *     today. The shared panels that already distinguish failure (#2231:
 *     deals-data-table, header search, team-client) show what the fix looks like
 *     when someone takes that slice.
 *
 * Usage:
 *   npm run guard:panel-errors            # check the tree against the baseline
 *   npm run guard:panel-errors -- --json  # machine-readable
 *   node scripts/check-panel-error-state.mjs --write   # regenerate the baseline
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app'];
const BASELINE_PATH = 'scripts/panel-error-state-baseline.json';
const ISSUE = '#2829';
const jsonOnly = process.argv.includes('--json');
const writeMode = process.argv.includes('--write');

/** A read that could fail and be mistaken for "there are none". */
const QUERY_CALL = /\buse(?:Api)?Query\s*[<(]/;
/** The branch that decides "there are none" — a length test on a list. */
const EMPTY_TEST = /(?:!\s*)?[\w.$]+\.length\s*(?:===\s*0|==\s*0|<\s*1)\b|!\s*[\w.${]+\.length\b/;
/** The copy that claims absence, rendered inside such a branch: JSX text, a
 *  `title=`/`description=` prop, or a string in a ternary. Anchored to the
 *  branch on purpose — "No description" as a per-row fallback is honest copy
 *  about one field, and counting it would bury the real findings. */
const FALSE_EMPTY =
  /(?:>|"|`|'|\(|^)\s*((?:No|None|Nothing)\s+[A-Za-z' ,\-]{2,46}|[A-Za-z' ,\-]{2,46}\s+is empty|[A-Za-z' ,\-]{2,46}\s+will appear here)/g;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Strip line and block comments: a comment that names `error` must not count as
 *  the panel reading it — that is how a false-empty panel talks its way out of
 *  the guard, which is the failure mode #2259 had with commented-out checks. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');
}

/** Every identifier this file assigns a query result to (`const q = useQuery(...)`
 *  and the `{ data, error } = useApiQuery(...)` form). */
function queryBindings(code) {
  const named = new Set();
  for (const m of code.matchAll(/\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*use(?:Api)?Query\s*[<(]/g)) named.add(m[1]);
  return named;
}

/** Does the file distinguish a failed read from an empty one? */
function readsFailure(code, named) {
  if (/\{\s*[^{}]*\b(?:error|isError)\b[^{}]*\}\s*=\s*use(?:Api)?Query?/.test(code)) return true;
  if (/\berror\s*:/.test(code) && /use(?:Api)?Query\s*[<(][\s\S]{0,400}?\berror\s*:/.test(code)) return true;
  for (const name of named) {
    if (new RegExp(`\\b${name}\\.(?:error|isError)\\b`).test(code)) return true;
  }
  return false;
}

/** Lines whose branch is a "there are none" branch, and how far below each one
 *  the rendered copy can sit before it stopped being that branch's JSX. */
function emptyBranchLines(lines) {
  const windows = [];
  lines.forEach((line, i) => {
    if (!EMPTY_TEST.test(line)) return;
    for (let j = i; j < Math.min(lines.length, i + 15); j++) windows.push(j);
  });
  return new Set(windows);
}

function falseEmptySentences(code) {
  const lines = code.split('\n');
  const inBranch = emptyBranchLines(lines);
  const hits = [];
  const seen = new Set();
  lines.forEach((line, i) => {
    if (!inBranch.has(i)) return;
    for (const m of line.matchAll(FALSE_EMPTY)) {
      const text = m[1].trim().replace(/[\s'",.]+$/, '');
      if (!text || seen.has(text)) continue;
      seen.add(text);
      hits.push({ line: i + 1, text });
    }
  });
  return hits.sort((a, b) => a.line - b.line);
}

let baseline = {};
try {
  // `{ _comment, count, panels: { file: { issue, sentences } } }` — what --write emits.
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).panels ?? {};
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const found = [];
for (const file of ROOTS.flatMap(walk)) {
  const src = readFileSync(file, 'utf8');
  const code = codeOnly(src);
  if (!QUERY_CALL.test(code)) continue;
  if (readsFailure(code, queryBindings(code))) continue;
  const sentences = falseEmptySentences(code);
  if (!sentences.length) continue;
  found.push({ file, sentences });
}

const outstanding = found.filter((f) => baseline[f.file]);
const offenders = found.filter((f) => !baseline[f.file]);
const stale = Object.keys(baseline).filter((k) => !found.some((f) => f.file === k));

if (writeMode) {
  const next = {};
  for (const f of found.sort((a, b) => a.file.localeCompare(b.file))) {
    next[f.file] = {
      // Portal reads are #2825's, and its PR is open; everything else is this issue.
      issue: baseline[f.file]?.issue ?? (f.file.startsWith('app/portal/') ? '#2825' : ISSUE),
      sentences: f.sentences.map((s) => s.text),
    };
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify({
    _comment: [
      'Ratchet for panels that render "there are none" when the read failed (#2829).',
      'Generated by: node scripts/check-panel-error-state.mjs --write',
      'Each entry names the issue that carries the panel. Fix the panel and delete its',
      'entry — the guard fails a NEW panel joining the class and prints a hint when a',
      'listed one leaves it, so the list only ever shrinks.',
    ],
    count: Object.keys(next).length,
    panels: next,
  }, null, 2)}\n`);
  console.log(`[check-panel-error-state] wrote ${Object.keys(next).length} entries to ${BASELINE_PATH}`);
  process.exit(0);
}

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify({ ok: offenders.length === 0, offenders, outstanding: outstanding.length, stale }, null, 2)}\n`);
  process.exitCode = offenders.length === 0 ? 0 : 1;
} else {
  console.log(`[check-panel-error-state] ${found.length} panel(s) in the class; ${outstanding.length} allowlisted (${ISSUE}), ${offenders.length} new`);
  if (offenders.length) {
    console.error(
      `\n  ✖ ${offenders.length} panel(s) render a false-empty sentence and never read the query's failure:\n` +
        offenders.map((o) => `    - ${o.file}\n${o.sentences.map((s) => `        :${s.line}  "${s.text}"`).join('\n')}`).join('\n') +
        `\n\n  Bind \`error\` (and \`refetch\`) from the query and render <InlineErrorState> instead of\n` +
        `  the sentence when the read failed and nothing is cached — see\n` +
        `  components/shared/inline-error-state.tsx (#2231) and app/tenant/settings/rbac/page.tsx.\n` +
        `  Adding an entry to ${BASELINE_PATH} is allowed only with a written issue number.\n`,
    );
    process.exitCode = 1;
  }
  if (stale.length) {
    console.log(
      `\n  ℹ ${stale.length} allowlisted panel(s) no longer match the class — delete their entries to tighten the ratchet:\n` +
        stale.map((s) => `    - ${s}`).join('\n'),
    );
  }
  if (!offenders.length) console.log(`[check-panel-error-state] OK — no new false-empty panels.`);
}
