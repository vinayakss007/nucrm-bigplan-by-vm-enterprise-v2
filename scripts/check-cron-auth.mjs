/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Cron auth coverage guard (#3298).
 *
 * `lib/auth/cron.ts` advertises three defence-in-depth layers on top of the shared
 * `CRON_SECRET` — IP allowlisting (`CRON_ALLOWED_IPS`), HMAC request signing
 * (`CRON_SIGNING_KEY`) and a denial audit — and all three live inside
 * `verifyCronSecret`. Measured on `main` at cc0b4e2c1, **2 of the 22 cron routes called
 * it**; the other 20 compared the header against `process.env.CRON_SECRET` by hand with
 * `lib/crypto.verifySecret`, which is timing-safe and fails closed on an unset secret, so
 * nothing looked broken: the two documented env vars simply had no effect on 20 endpoints.
 *
 * Two shapes are therefore named as failures:
 *
 *  1. A route reaching for `verifySecret` — the right helper for a webhook signature, the
 *     wrong one for a cron call, because the three layers are not in it.
 *  2. An un-awaited `verifyCronSecret`. This is why the rule reads the *call*, not the
 *     import list: the return value is a Promise, a Promise is always truthy, so
 *     `if (!verifyCronSecret(req)) { 401 }` admits any caller with any header. The guard
 *     is here for the fail-OPEN mistake, not the fail-closed one.
 *
 * A `withCronRoute(handler)` wrapper was rejected: `cron/cleanup` authenticates a *second*
 * principal (a signed-in super admin, #1087) so the exemption list survives anyway, and
 * routes disagree on whether they rate-limit before or after authenticating — a wrapper
 * would silently re-order 22 endpoints. So the routes keep calling the check, and this
 * guard keeps them doing it.
 *
 * Exemptions are tracked in `scripts/cron-auth-baseline.json` as
 * `{ route, reason }` and are **shrink-only**: an entry whose route no longer exists fails,
 * and a route that becomes exempt without a recorded reason fails. There are none today.
 *
 * Usage (from the repo root): node scripts/check-cron-auth.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CRON_DIR = 'app/api/cron';
export const BASELINE_FILE = 'scripts/cron-auth-baseline.json';
export const CRON_AUTH_MODULE = '@/lib/auth/cron';

/** The primitive that must not be reached for directly from a cron route. */
const BARE_SECRET_CALL = /(?:^|[^\w.])verifySecret\s*\(/;
const BARE_SECRET_IMPORT = /import\s*\{[^}]*\bverifySecret\b[^}]*\}\s*from\s*['"]@\/lib\/crypto['"]/;
const IMPORTS_AUTH_MODULE = new RegExp(`import\\s*\\{[^}]*\\bverifyCronSecret\\b[^}]*\\}\\s*from\\s*['"]${CRON_AUTH_MODULE.replace(/\//g, '\\/')}['"]`);

/**
 * `verifyCronSecret(` with no `await` in front of it. Matches across a line break
 * (`if (!\n  verifyCronSecret(`), which is how a wrapped condition actually reads.
 */
const UNAWAITED_CALL = /(?:^|[^.\w$])(?<!await\s)(?<!await )verifyCronSecret\s*\(/gm;

// ── Pure rules: source in, problems out (no filesystem touched) ─────────────

/** @returns {string[]} the routes that have a route.ts under CRON_DIR, sorted. */
export function listRoutes(readDir) {
  return readDir(CRON_DIR)
    .filter((name) => name !== 'baseline.json')
    .sort();
}

/**
 * One route, one verdict. `exempt` routes are skipped for rules 1-3 but still have to
 * appear in the baseline (checked by `checkBaselineIsTight`).
 */
export function checkRouteSource(route, src) {
  const problems = [];
  const file = join(CRON_DIR, route, 'route.ts');

  if (BARE_SECRET_IMPORT.test(src) || BARE_SECRET_CALL.test(src)) {
    problems.push(
      `${file} authenticates with the bare secret primitive \`verifySecret\`. It is timing-safe, ` +
        `so the route looks correct — but the IP allowlist, the \`CRON_SIGNING_KEY\` HMAC and the ` +
        `denial audit live only in verifyCronSecret (#3298).`,
    );
  }

  const calls = /(?:^|[^.\w$])verifyCronSecret\s*\(/.test(src);
  if (!IMPORTS_AUTH_MODULE.test(src) || !calls) {
    problems.push(
      `${file} does not authenticate through ${CRON_AUTH_MODULE}: ` +
        `${IMPORTS_AUTH_MODULE.test(src) ? 'it imports the module but never calls verifyCronSecret' : 'no verifyCronSecret import'} (#3298).`,
    );
  }

  const unawaited = [...src.matchAll(UNAWAITED_CALL)];
  if (unawaited.length > 0) {
    const at = src.slice(0, unawaited[0].index ?? 0).split('\n').length;
    problems.push(
      `${file}:${at} calls \`verifyCronSecret\` without \`await\`. The return value is a Promise, ` +
        `a Promise is always truthy, so \`if (!verifyCronSecret(req)) { 401 }\` never fires and the ` +
        `route accepts every caller — fail-OPEN (#3298).`,
    );
  }

  return problems;
}

/**
 * The baseline may only shrink: an entry naming a route that no longer exists, or with no
 * reason, is itself a problem — otherwise the exemption list quietly becomes the permit that
 * #3298 was filed against.
 */
export function checkBaselineIsTight(baseline, routes) {
  const problems = [];
  const seen = new Set();
  for (const entry of baseline) {
    const route = typeof entry?.route === 'string' ? entry.route : null;
    const reason = typeof entry?.reason === 'string' ? entry.reason.trim() : '';
    if (!route) {
      problems.push(`${BASELINE_FILE}: an entry has no \`route\` field — a blank exemption covers nothing.`);
      continue;
    }
    if (seen.has(route)) {
      problems.push(`${BASELINE_FILE}: "${route}" is listed twice.`);
      continue;
    }
    seen.add(route);
    if (!routes.includes(route)) {
      problems.push(
        `${BASELINE_FILE} exempts "${route}", which has no ${join(CRON_DIR, route, 'route.ts')}. ` +
          `Delete the entry: exemptions are tracked debt that may only shrink (#3298).`,
      );
    }
    if (reason.length < 20) {
      problems.push(
        `${BASELINE_FILE}: the "${route}" exemption needs a real reason (>= 20 chars), not a ` +
          `placeholder — an unexplained exemption is the fail-open this guard exists to stop.`,
      );
    }
  }
  return problems;
}

/** Rules 1-3 across every non-exempt route. */
export function runChecks({ routes, readRoute, exemptRoutes = [] }) {
  const problems = [];
  for (const route of routes) {
    if (exemptRoutes.includes(route)) continue;
    problems.push(...checkRouteSource(route, readRoute(route)));
  }
  return { problems, counts: { routes: routes.length, exempt: exemptRoutes.length } };
}

// ── CLI: read the real tree, run the rules, print, exit ─────────────────────
export function main() {
  if (!existsSync(CRON_DIR)) {
    console.error(`[check-cron-auth] FAIL — ${CRON_DIR} does not exist (run from the repo root).`);
    process.exit(1);
  }
  const read = (file) => readFileSync(file, 'utf8');
  const entries = readdirSync(CRON_DIR, { withFileTypes: true });
  const routes = entries
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(CRON_DIR, e.name, 'route.ts')))
    .map((e) => e.name)
    .sort();

  let baseline = [];
  try {
    baseline = JSON.parse(read(BASELINE_FILE));
  } catch (err) {
    if (!(err instanceof SyntaxError) && !/ENOENT/.test(String(err))) throw err;
    baseline = [];
  }
  const exempt = baseline.map((e) => e?.route).filter(Boolean);

  const { problems: routeProblems, counts } = runChecks({
    routes,
    readRoute: (dir) => read(join(CRON_DIR, dir, 'route.ts')),
    exemptRoutes: exempt,
  });
  const problems = [...routeProblems, ...checkBaselineIsTight(baseline, routes)];

  if (problems.length > 0) {
    console.error(
      `\n[check-cron-auth] FAIL — ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n\n` +
        problems.map((p) => `    - ${p}`).join('\n\n') +
        '\n',
    );
    process.exit(1);
  }
  console.log(
    `[check-cron-auth] OK — ${counts.routes} cron routes all authenticate through ` +
      `${CRON_AUTH_MODULE} with an awaited verifyCronSecret; ${counts.exempt} exempt (all named with ` +
      `a reason in ${BASELINE_FILE}).`,
  );
}

// Run only when invoked as a CLI, so unit tests can import the pure logic.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
