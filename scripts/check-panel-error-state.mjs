#!/usr/bin/env node
/**
 * Guard: a panel that renders "there are none" must be able to tell that the
 * read failed.
 *
 * #2439 (routes), #2823 (two super-admin panels), #2825 (the customer portal)
 * and #2829 (the rest of the app) are the same accident: a page destructures
 * `{ data, isLoading }` from `useApiQuery`, never binds `error`, and renders a
 * sentence about the tenant's data whenever the array comes back empty. An RLS
 * refusal, a dead pool or a 500 is then reported as "No backups yet", "No
 * sessions found", "Trash is empty" — a false all-clear on the panels whose job
 * is to answer those questions.
 *
 * The screen is a proxy, deliberately: reading which JSX branch an `error`
 * would reach needs a parser, and this repo's guards are grep-shaped. So a page
 * passes when it binds `error`/`isError` from its query AND renders a failure
 * affordance (`InlineErrorState`, an `role="alert"` block, or `ErrorFallback`).
 * A page that binds `error` and never shows it is the hole a proxy cannot close
 * — that half is carried by the render tests (`panel-fetch-error-not-empty-2823`,
 * `portal-page-error-not-empty-2825`, `panel-error-state-2829`), which fail the
 * same sentence against a stubbed 500.
 *
 * Ratcheting, the way `guard:filesize` and `schema-drift-allowlist` do it: the
 * pages still outstanding are listed in `scripts/panel-error-state-baseline.json`,
 * each naming the issue that carries it. A NEW page joining the class fails CI;
 * a baseline entry that has been fixed is reported so the file decays honestly.
 *
 * Run: `npm run guard:panel-error-state` (wired into ci.yml).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = 'scripts/panel-error-state-baseline.json';

/** The hook call whose result the page reads. */
const QUERY_RE = /const\s*\{([^}]*)\}\s*=\s*(?:useApiQuery|useQuery)\b/g;
/** A sentence that asserts the tenant has none of a thing. */
const EMPTY_SENTENCE =
  /(?:\bNo\s+[A-Za-z][\w /-]{1,40}?\b(?:yet|found|here|configured|recorded|logged|sent|match|match your search)\b|\bis empty\b|\bNothing here\b|\bTrash is empty\b)/i;
/** The branch that decides to say it. */
const EMPTY_TEST = /(?:\.length\s*===\s*0|\.length\s*<=\s*0|!\w+(?:\.\w+)*\.length\b|!\w+\.data\?\.length\b)/;
/** Anything that tells the user the read failed instead. */
const FAILURE_AFFORDANCE = /InlineErrorState|ErrorFallback|role=["']alert["']/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) {
      if (p.endsWith('.tsx')) yield p;
      continue;
    }
    yield* walk(p);
  }
}

/** True when some empty-array branch within `window` lines renders the sentence. */
function rendersFalseEmpty(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!EMPTY_TEST.test(lines[i])) continue;
    const window = lines.slice(i, i + 8).join(' ');
    if (EMPTY_SENTENCE.test(window)) return { line: i + 1, text: firstSentence(window) };
  }
  return null;
}

function firstSentence(chunk) {
  const m = chunk.match(EMPTY_SENTENCE);
  return m ? m[0].replace(/\s+/g, ' ').slice(0, 48) : '';
}

/**
 * @param {string} rel path relative to ROOT
 * @param {string} src file contents
 * @returns {{offends: boolean, why?: string}}
 */
export function inspect(rel, src) {
  const lines = src.split('\n');
  const empty = rendersFalseEmpty(lines);
  if (!empty) return { offends: false };

  let queries = 0;
  let bindsError = false;
  QUERY_RE.lastIndex = 0;
  let m;
  while ((m = QUERY_RE.exec(src))) {
    queries++;
    if (/\berror\b|\bisError\b/.test(m[1])) bindsError = true;
  }
  if (!queries) return { offends: false };
  // The proxy: the page must both see the failure and show something for it.
  if (bindsError && FAILURE_AFFORDANCE.test(src)) return { offends: false };

  return {
    offends: true,
    why: `${rel}:${empty.line} says "${empty.text}" with no failure branch (${queries} query hook${queries > 1 ? 's' : ''}, error never bound)`,
  };
}

/**
 * @param {string} root
 * @param {{baseline?: Map<string, string>}} [opts]
 */
export function scan(root, opts = {}) {
  const offenders = [];
  for (const file of walk(join(root, 'app'))) {
    const rel = relative(root, file);
    const res = inspect(rel, readFileSync(file, 'utf8'));
    if (res.offends) offenders.push(res);
  }

  const baseline = opts.baseline ?? new Map();
  const novel = offenders.filter((o) => !baseline.has(o.why.split(':')[0]));
  const stale = [...baseline.keys()].filter(
    (f) => !offenders.some((o) => o.why.startsWith(`${f}:`)),
  );
  return { offenders, novel, stale };
}

export function loadBaseline(root = ROOT, path = BASELINE_PATH) {
  const abs = join(root, path);
  if (!existsSync(abs)) return new Map();
  const doc = JSON.parse(readFileSync(abs, 'utf8'));
  return new Map(Object.entries(doc.files ?? {}));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { offenders, novel, stale } = scan(ROOT, { baseline: loadBaseline() });
  for (const s of stale) {
    console.error(`[check-panel-error-state] note: ${s} no longer offends — remove it from the baseline.`);
  }
  if (novel.length > 0) {
    console.error(
      '\n[check-panel-error-state] FAIL — a panel reports "there are none" for a failed read (#2829).\n' +
        '\n  An unread page may not state a fact about the tenant\'s data.\n' +
        '  Bind `error` from the query and render <InlineErrorState message="…" onRetry={…}\n' +
        '  in the branch that currently prints the empty sentence — the way\n' +
        '  app/tenant/settings/webhooks/dlq/page.tsx does.\n\n' +
        novel.map((o) => `    ${o.why}`).join('\n') +
        '\n\n  If the page is genuinely waiting on another PR, name it with a written\n' +
        `  issue in ${BASELINE_PATH} — in a reviewed PR, not as a shortcut.\n`,
    );
    process.exit(1);
  }
  console.log(
    `[check-panel-error-state] OK — ${offenders.length} panel(s) still print an empty sentence over a failed read, every one of them listed in ${BASELINE_PATH}.`,
  );
}
