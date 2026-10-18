#!/usr/bin/env node
/**
 * Guard: a panel that renders "there are none" must be able to tell that the
 * read failed.
 *
 * #2439 (routes), #2823 (two super-admin panels), #2825 (the customer portal)
 * and #2829 (the rest of the app) are the same accident: a page reads its rows
 * from `useApiQuery` and renders a sentence about the tenant's data whenever the
 * array comes back empty, whatever else happened. Either the hook's `error` is
 * never bound at all, or it is bound and routed to a `useEffect` toast that
 * speaks for four seconds and leaves the sentence behind it on screen. An RLS
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
 * `portal-page-error-not-empty-2825`, `panel-page-error-not-empty-2829`), which
 * fail the same sentence against a stubbed 500, and by
 * `panel-error-state-guard-2829`, which plants each shape in this screen against
 * sources so a regex that stops matching cannot pass silently.
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
export const QUERY_RE = /const\s*\{([^}]*)\}\s*=\s*(?:useApiQuery|useQuery)\b/g;
/** A sentence that asserts the tenant has none of a thing. */
export const EMPTY_SENTENCE =
  /(?:\bNo\s+[A-Za-z][\w /-]{1,40}?\b(?:yet|found|here|configured|recorded|logged|sent|match|match your search)\b|\bis empty\b|\bNothing here\b|\bTrash is empty\b)/i;
/** The branch that decides to say it. */
export const EMPTY_TEST = /(?:\.length\s*===\s*0|\.length\s*<=\s*0|!\w+(?:\.\w+)*\.length\b|!\w+\.data\?\.length\b)/;
/** Anything that tells the user the read failed instead. */
export const FAILURE_AFFORDANCE = /InlineErrorState|ErrorFallback|role=["']alert["']/;

/** JSX text: the words follow an opening tag on the same line… */
const AFTER_TAG = />\s*$/;
/** …or are passed in as the copy prop of an empty-state component. */
const AFTER_PROP = /\b(?:title|description|label|message)=["'`{]\s*$/;
/** …or a quoted string arm of a ternary inside a JSX expression. */
const AFTER_QUOTED = /[?:(|&{=,>]\s*["'`]\s*$/;
/** A failure the page already surfaces through some other channel. */
const HANDLED_INLINE = /toast(?:\.error)?\(|setError\(/;

export function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) {
      if (p.endsWith('.tsx')) yield p;
      continue;
    }
    yield* walk(p);
  }
}

/**
 * The first "there are none" sentence that sits under an emptiness test. Looking
 * backwards rather than forwards is what keeps the screen honest: the branch is
 * the `{!rows.length ? (` ABOVE the words, and copy that lives in a comment, a
 * toast, or a `setError()` the page renders elsewhere is not a panel asserting
 * that the tenant has none.
 */
export function rendersFalseEmpty(lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HANDLED_INLINE.test(line)) continue;
    const m = EMPTY_SENTENCE.exec(line);
    if (!m) continue;
    const before = line.slice(0, m.index);
    // The words are rendered only if they follow an opening tag or a copy prop —
    // on this line, or as the text node directly under one on the line above.
    const above = lines.slice(0, i).reverse().find((l) => l.trim() !== '');
    const rendered =
      AFTER_TAG.test(before) ||
      AFTER_PROP.test(before) ||
      AFTER_QUOTED.test(before) ||
      (before.trim() === '' && />\s*$/.test(above ?? ''));
    if (!rendered) continue;
    const back = lines.slice(Math.max(0, i - 10), i + 1).join(' ');
    if (!EMPTY_TEST.test(back)) continue;
    return { line: i + 1, text: m[0].replace(/\s+/g, ' ').slice(0, 48) };
  }
  return null;
}

/**
 * Two shapes reach the same sentence, and the message names whichever it found:
 * a page whose hook never binds `error`, and a page that binds it and routes it
 * to a `useEffect` toast — which says the read failed for four seconds and then
 * leaves the false sentence on screen permanently.
 *
 * @param {string} rel path relative to ROOT
 * @param {string} src file contents
 * @returns {{offends: boolean, why?: string, bindsError?: boolean}}
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
    bindsError,
    why:
      `${rel}:${empty.line} says "${empty.text}" with no failure branch ` +
      `(${queries} query hook${queries > 1 ? 's' : ''}, ` +
      `${bindsError ? '`error` bound but never rendered' : '`error` never bound'})`,
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
