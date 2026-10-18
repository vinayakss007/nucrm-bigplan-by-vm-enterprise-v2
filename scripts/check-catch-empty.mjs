#!/usr/bin/env node
/**
 * Guard: a `catch` in an API route must not assert that a collection is empty.
 *
 * Issue #2825 (following #2439, #2446, #2539 and #2823, which are the same
 * argument on other surfaces): three portal reads answered `200 { data: [] }`
 * from their catch block, so an RLS refusal, a dead pool or a missing column was
 * rendered to a customer as "you have no quotes". A catch body may report a
 * failure; it may not state a fact about the tenant's data, because it never
 * looked at it.
 *
 * The screen is deliberately narrow — a `catch` block that returns a
 * `NextResponse.json(...)` whose payload is an empty collection, an empty
 * object, or `ok: true`, with no 4xx/5xx status. Everything else passes:
 * `apiError(err)`, a rethrow, `{ error } + 5xx`, and the 100+ catch blocks that
 * answer 400 for a malformed body.
 *
 * Run: `npm run guard:catch-empty` (wired into ci.yml). The exported functions
 * are unit-tested in tests/unit/catch-empty-guard-2825.test.ts, because a screen
 * that quietly stops matching prints "OK" over the exact bug it exists to catch.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Exceptions — each one a documented decision, not an oversight. */
export const ALLOW = new Map([
  [
    'app/api/auth/forgot-password/route.ts',
    'Every path answers {ok:true} on purpose: confirming an unknown email is an enumeration oracle. The send happens in a background IIFE that logs its own failure.',
  ],
  [
    'app/api/tenant/visitors/track/route.ts',
    'public/visitor-tracker.js is an embed with no error path of its own; a non-2xx would surface on the customer site. The failure is logged server-side.',
  ],
]);

/** A payload that states "there is none", or "it worked", with nothing behind it. */
export const EMPTY_PAYLOAD =
  /(?:\b(?:data|items|results?|rows|logs|records|entries|list)\s*:\s*\[\s*\]|\bok\s*:\s*true\b|^\{\s*\}$)/;

/** The `{ … }` literal starting at `from` (an index of `{`), brace-matched. */
export function objectLiteral(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
  }
  return null;
}

/** Findings for one source file; `rel` only selects an ALLOW entry. */
export function scanSource(rel, src) {
  const out = [];
  const catches = /\bcatch\b[^{]*\{/g;
  let c;
  while ((c = catches.exec(src))) {
    const open = c.index + c[0].length - 1;
    const body = objectLiteral(src, open);
    if (!body) continue;
    catches.lastIndex = open + body.length;

    const jsons = /NextResponse\.json\(\s*\{/g;
    let j;
    while ((j = jsons.exec(body))) {
      const start = j.index + j[0].length - 1;
      const literal = objectLiteral(body, start);
      if (!literal || !EMPTY_PAYLOAD.test(literal)) continue;
      if (/^\s*,\s*\{\s*status:\s*[45]\d\d/.test(body.slice(start + literal.length))) continue;
      out.push({
        rel,
        line: src.slice(0, c.index).split('\n').length,
        payload: literal.replace(/\s+/g, ' ').slice(0, 60),
      });
    }
  }
  return out;
}

/** Every `app/**\/route.ts` under `root`. */
export function* routeFiles(root, dir = 'app') {
  for (const name of readdirSync(join(root, dir))) {
    const p = join(root, dir, name);
    if (statSync(p).isDirectory()) yield* routeFiles(root, relative(root, p));
    else if (name === 'route.ts') yield p;
  }
}

export function scan(root) {
  const findings = [];
  for (const file of routeFiles(root)) {
    const rel = relative(root, file);
    if (ALLOW.has(rel)) continue;
    findings.push(...scanSource(rel, readFileSync(file, 'utf8')));
  }
  return findings;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const findings = scan(process.cwd());
  if (findings.length > 0) {
    console.error(
      '\n[check-catch-empty] FAIL — a catch block asserts an empty result (#2825).\n' +
        '\n  A catch never saw the data, so it cannot report that there is none.\n' +
        '  Answer a 5xx with { error } and log it, the way app/api/public/invoices\n' +
        '  does (#2439):\n\n' +
        findings.map((f) => `    ${f.rel}:${f.line}  catch returns ${f.payload}`).join('\n') +
        '\n',
    );
    process.exit(1);
  }
  console.log('[check-catch-empty] OK — no API catch returns an empty payload as if it were a result.');
}
