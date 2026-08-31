/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * CSRF coverage guard (#C2).
 *
 * State-changing endpoints must be protected against CSRF. There is no root
 * Next.js middleware, so protection comes from one of:
 *   - requireAuth() — the central backstop (lib/auth/middleware.ts) which, when
 *     CSRF_ENFORCE_CENTRAL is on, validates the double-submit token for
 *     cookie-authenticated mutations; OR
 *   - an explicit requireCsrf(request) call in the handler.
 *
 * This guard fails CI when a route file exposes a mutating handler
 * (POST/PUT/PATCH/DELETE) that does NEITHER, and is NOT on the documented
 * CSRF-exempt allowlist (kept in sync with needsCsrfValidation in
 * lib/auth/csrf.ts). It prevents silently adding a state-changing endpoint that
 * relies on ambient cookie credentials with no CSRF defense.
 *
 * The allowlist mirrors needsCsrfValidation(): webhooks, cron, public forms,
 * public leads, setup, tenant onboarding, and the pre-auth auth routes. These
 * are either unauthenticated or authenticated by signature/secret rather than a
 * session cookie, so CSRF does not apply.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app/api';
const BASELINE_PATH = 'scripts/csrf-coverage-baseline.json';

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
  '/api/tenant/onboarding',
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
// it establishes a session context, so a route using it is session-protected
// (and now covered by the central CSRF backstop via the same mechanism).
const REQUIRE_AUTH_RE = /\b(requireAuth|requireTenantCtx)\s*\(/;
const REQUIRE_CSRF_RE = /\brequireCsrf\s*\(/;

const files = walk(ROOT);
const offenders = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!MUTATING_EXPORT_RE.test(src)) continue; // no state-changing handler
  const apiPath = toApiPath(file);
  if (isExempt(apiPath)) continue;

  // Protected if it authenticates (central backstop) or calls requireCsrf.
  if (REQUIRE_AUTH_RE.test(src) || REQUIRE_CSRF_RE.test(src)) continue;

  offenders.push(apiPath);
}

// Split offenders into new (fail) vs grandfathered (allowed, tracked).
const newOffenders = offenders.filter((p) => !baseline.has(p));
const stale = [...baseline].filter((p) => !offenders.includes(p));

if (stale.length > 0) {
  console.log(
    `[check-csrf-coverage] NOTE: ${stale.length} baseline entr(y/ies) are now protected and can be removed from ${BASELINE_PATH}:\n` +
      stale.map((f) => `    - ${f}`).join('\n'),
  );
}

if (newOffenders.length > 0) {
  console.error(
    '\n\u001b[31m\u2716 CSRF coverage guard failed (#C2).\u001b[0m\n' +
      '\n' +
      '  The following routes expose a state-changing handler (POST/PUT/PATCH/DELETE)\n' +
      '  that neither authenticates via requireAuth() (the central CSRF backstop) nor\n' +
      '  calls requireCsrf(), and is not on the CSRF-exempt allowlist:\n\n' +
      newOffenders.map((f) => `    - ${f}`).join('\n') +
      '\n\n' +
      '  Fix one of:\n' +
      '    - call requireAuth(request) if the route is session-authenticated, or\n' +
      '    - call requireCsrf(request) explicitly, or\n' +
      '    - if it is a webhook/cron/public endpoint, add it to the exempt list in\n' +
      '      BOTH lib/auth/csrf.ts (needsCsrfValidation) and this guard.\n' +
      '  Do NOT add new routes to scripts/csrf-coverage-baseline.json.\n',
  );
  process.exit(1);
}

console.log(
  `[check-csrf-coverage] OK — ${files.length} API routes scanned; ` +
    `all mutating handlers are CSRF-protected, exempt, or grandfathered (${baseline.size} baseline).`,
);
