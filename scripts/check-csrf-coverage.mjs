/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * CSRF coverage guard (#C2, #2561).
 *
 * State-changing endpoints must be protected against CSRF. Where that check
 * actually lives, measured on this tree rather than assumed:
 *   - proxy.ts is the root Next.js proxy, and it validates the double-submit
 *     token for every /api/ mutation that carries a token. That is the
 *     load-bearing defense for the ~290 route files whose only CSRF claim is a
 *     `requireAuth()` call. The previous text of this guard asserted "there is
 *     no root Next.js middleware", which is false, and let it credit
 *     requireAuth() with coverage it does not itself provide.
 *   - an explicit `requireCsrf(request)` in the handler is the only thing that
 *     covers a route on the paths the proxy passes through early: a
 *     `Bearer ak_*` request on an API-key-allowed path returns at
 *     proxy.ts:466 — before the CSRF block — and requireAuth() then falls back
 *     to the ambient session cookie (lib/auth/middleware.ts:262). New state-
 *     changing routes that write tenant data should call it, as
 *     app/api/tenant/integrations/route.ts:76 (#1835) and now plugin-engine do.
 *   - requireAuth()'s own backstop (lib/auth/middleware.ts:220-227) is behind
 *     `CSRF_ENFORCE_CENTRAL`, which no file in this repo sets, so it never runs.
 *     It is not the reason a requireAuth-only route is safe — the proxy is.
 *
 * So this guard asserts three things and reports a fourth:
 *   1. (fail) a route file exposing a mutating handler (POST/PUT/PATCH/DELETE)
 *      that neither authenticates nor calls requireCsrf(), and is not on the
 *      documented CSRF-exempt allowlist;
 *   2. (fail) proxy.ts still performs the edge validation ~290 routes rest on,
 *      ungated — nothing else in CI notices if a refactor drops it or puts it
 *      behind a flag, which is exactly how the middleware.ts backstop ended up
 *      dead code;
 *   3. (fail) this guard's exempt lists still match the literals inside
 *      needsCsrfValidation(), so the two cannot drift apart silently;
 *   4. (report) how many mutating routes are covered by which mechanism, on
 *      every run, instead of asserting "all handlers are protected".
 *
 * There is deliberately NO ratchet on the requireAuth-only count. Those routes
 * are CSRF-covered today (assertion 2 is what protects them), so a growing
 * count is not a growing hole, and capping it would push authors toward an
 * in-handler call chosen for the number rather than for the ak_ pass-through
 * that actually needs one. #2561 filed the flag question — set
 * CSRF_ENFORCE_CENTRAL, or stop calling the middleware.ts branch a backstop —
 * as an owner decision instead.
 *
 * The exempt lists mirror needsCsrfValidation(): webhooks, cron, public forms,
 * public leads, setup, and the pre-auth auth routes. These
 * are either unauthenticated or authenticated by signature/secret rather than a
 * session cookie, so CSRF does not apply.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app/api';
const BASELINE_PATH = 'scripts/csrf-coverage-baseline.json';
const PROXY_PATH = 'proxy.ts';
const CSRF_LIB_PATH = 'lib/auth/csrf.ts';

/**
 * Grandfathered routes that predate this guard. Each is CSRF-safe for a reason
 * other than requireAuth/requireCsrf — public/unauthenticated, signature- or
 * token-verified (webhooks, SCIM/OAuth/v1/v2 API gateways), or a public
 * accept/decline/track link. New routes must NOT be added here; fix them
 * instead. Removing a route from the baseline once it calls requireAuth/
 * requireCsrf is encouraged (the guard hints when a baseline entry is stale).
 */
let baseline = new Set();
if (existsSync(BASELINE_PATH)) {
  try {
    baseline = new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
  } catch {
    console.error(`[check-csrf-coverage] could not parse ${BASELINE_PATH}`);
    process.exit(1);
  }
}

// Path prefixes/exact paths that needsCsrfValidation() exempts. Kept in sync
// with lib/auth/csrf.ts. Compared against the URL path derived from the file
// location (app/api/foo/bar/route.ts -> /api/foo/bar).
const EXEMPT_PREFIXES = [
  '/api/webhooks/',
  '/api/cron/',
  '/api/forms/',
  '/api/leads/public/',
  '/api/setup/',
];
const EXEMPT_EXACT = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/resend-verification',
  '/api/auth/verify-email',
]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p);
  }
  return out;
}

/** app/api/foo/[id]/route.ts -> /api/foo/[id] (dynamic segments kept as-is). */
function toApiPath(file) {
  return (
    '/' +
    file
      .replace(/\\/g, '/')
      .replace(/^app\//, '')
      .replace(/\/route\.tsx?$/, '')
  );
}

function isExempt(apiPath) {
  if (EXEMPT_EXACT.has(apiPath)) return true;
  return EXEMPT_PREFIXES.some((p) => apiPath === p || apiPath.startsWith(p));
}

const MUTATING_EXPORT_RE = /export\s+(?:const|async\s+function)\s+(POST|PUT|PATCH|DELETE)\b/;
// requireTenantCtx() is the Server-Component/action auth path; like requireAuth
// it establishes a session context, so a route using it is session-authenticated
// (and so is covered by the proxy's edge check — not by anything in these two
// functions, which is the point #2561 makes).
const REQUIRE_AUTH_RE = /\b(requireAuth|requireTenantCtx)\s*\(/;
const REQUIRE_CSRF_RE = /\brequireCsrf\s*\(/;

const files = walk(ROOT);
const offenders = [];
let inHandlerCount = 0;
let requireAuthOnlyCount = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!MUTATING_EXPORT_RE.test(src)) continue; // no state-changing handler
  const apiPath = toApiPath(file);
  if (isExempt(apiPath)) continue;

  const hasCsrf = REQUIRE_CSRF_RE.test(src);
  if (hasCsrf) inHandlerCount++;
  else if (REQUIRE_AUTH_RE.test(src)) requireAuthOnlyCount++;
  else offenders.push(apiPath);
}

/**
 * The edge check that the requireAuth-only population rests on must still exist
 * and still be unconditional. Both failure modes are ones this repo has already
 * shipped: a check that quietly stops being called, and a check that stays in the
 * source behind an env flag nobody sets (lib/auth/middleware.ts:220-227,
 * `CSRF_ENFORCE_CENTRAL`). ~300 routes pass this guard today because of that
 * call, and nothing else in CI notices if a refactor drops it.
 */
function edgeCheckProblems() {
  const problems = [];
  if (!existsSync(PROXY_PATH)) {
    return [
      `${PROXY_PATH} is gone. ${requireAuthOnlyCount} mutating route files have no in-handler ` +
        `requireCsrf() and rely on the proxy validating the double-submit token.`,
    ];
  }
  const src = readFileSync(PROXY_PATH, 'utf8');
  const callAt = src.search(/\bneedsCsrfValidation\s*\(/);
  if (callAt < 0) {
    return [
      `${PROXY_PATH} no longer calls needsCsrfValidation(): the edge CSRF check is gone, ` +
        `and ${requireAuthOnlyCount} mutating route files are protected by nothing but requireAuth().`,
    ];
  }
  if (!/CSRF token missing or invalid/.test(src)) {
    problems.push(
      `${PROXY_PATH} calls needsCsrfValidation() but no longer answers the CSRF denial — ` +
        `a check whose failure is never returned to the client is not enforcement.`,
    );
  }
  // A `process.env` test in the run-up to the call means enforcement is now opt-in.
  const before = src.slice(Math.max(0, callAt - 400), callAt);
  if (/process\.env/.test(before)) {
    problems.push(
      `the needsCsrfValidation() call in ${PROXY_PATH} is now behind a process.env test. ` +
        `Gating the edge check is how ${requireAuthOnlyCount} routes end up unprotected while ` +
        `this guard still prints OK. If the gate is intended, set it in every deployment and ` +
        `record it in the register.`,
    );
  }
  return problems;
}

/**
 * needsCsrfValidation() is the authority on what is exempt; this file only
 * mirrors it. Read the literals back out of the source, so an exemption added to
 * one side and not the other cannot silently hide (or invent) unprotected routes.
 */
function exemptDriftProblems() {
  const problems = [];
  if (!existsSync(CSRF_LIB_PATH)) {
    return [`${CSRF_LIB_PATH} is gone; this guard's exempt lists have nothing to mirror.`];
  }
  const src = readFileSync(CSRF_LIB_PATH, 'utf8');
  const start = src.search(/function needsCsrfValidation\s*\(/);
  if (start < 0) {
    return [`${CSRF_LIB_PATH} no longer defines needsCsrfValidation(); update this guard's exempt lists.`];
  }
  const body = src.slice(start);
  const codePrefixes = new Set([...body.matchAll(/path\.startsWith\(\s*'([^']+)'/g)].map((m) => m[1]));
  const codeExacts = new Set([...body.matchAll(/path\s*===\s*'([^']+)'/g)].map((m) => m[1]));
  for (const p of EXEMPT_PREFIXES) if (!codePrefixes.has(p)) problems.push(`this guard exempts prefix '${p}' but needsCsrfValidation() does not`);
  for (const p of codePrefixes) if (!EXEMPT_PREFIXES.includes(p)) problems.push(`needsCsrfValidation() exempts prefix '${p}' but this guard does not`);
  for (const p of EXEMPT_EXACT) if (!codeExacts.has(p)) problems.push(`this guard exempts '${p}' but needsCsrfValidation() does not`);
  for (const p of codeExacts) if (!EXEMPT_EXACT.has(p)) problems.push(`needsCsrfValidation() exempts '${p}' but this guard does not`);
  return problems;
}

const edgeProblems = edgeCheckProblems();
const driftProblems = exemptDriftProblems();

// Split offenders into new (fail) vs grandfathered (allowed, tracked).
const newOffenders = offenders.filter((p) => !baseline.has(p));
const stale = [...baseline].filter((p) => !offenders.includes(p));

if (stale.length > 0) {
  console.log(
    `[check-csrf-coverage] NOTE: ${stale.length} baseline entr(y/ies) are now protected and can be removed from ${BASELINE_PATH}:\n` +
      stale.map((f) => `    - ${f}`).join('\n'),
  );
}

if (newOffenders.length > 0 || edgeProblems.length > 0 || driftProblems.length > 0) {
  console.error('\n\u001b[31m\u2716 CSRF coverage guard failed (#C2 / #2561).\u001b[0m\n');
  if (newOffenders.length > 0) {
    console.error(
      '  The following routes expose a state-changing handler (POST/PUT/PATCH/DELETE)\n' +
        '  that neither authenticates via requireAuth() (whose coverage comes from the\n' +
        '  proxy edge check, not from requireAuth itself) nor calls requireCsrf(), and\n' +
        '  is not on the CSRF-exempt allowlist:\n\n' +
        newOffenders.map((f) => `    - ${f}`).join('\n') +
        '\n\n' +
        '  Fix one of:\n' +
        '    - call requireAuth(request) if the route is session-authenticated, or\n' +
        '    - call requireCsrf(request) explicitly — required for a route reachable on\n' +
        '      a path the proxy passes through early (proxy.ts:466, `Bearer ak_*`), or\n' +
        '    - if it is a webhook/cron/public endpoint, add it to the exempt list in\n' +
        '      BOTH lib/auth/csrf.ts (needsCsrfValidation) and this guard.\n' +
        '  Do NOT add new routes to scripts/csrf-coverage-baseline.json.\n',
    );
  }
  for (const p of edgeProblems) console.error(`  Edge enforcement: ${p}\n`);
  for (const p of driftProblems) console.error(`  Exempt-list drift: ${p}\n`);
  process.exit(1);
}

console.log(
  `[check-csrf-coverage] OK — ${files.length} API routes scanned; ` +
    `${inHandlerCount} mutating route files check CSRF in-handler, ${requireAuthOnlyCount} ` +
    `rely on the proxy's edge validation (asserted, not assumed), ` +
    `${baseline.size} baseline route(s) grandfathered.`,
);
