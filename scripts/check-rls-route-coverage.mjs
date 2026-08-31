/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * RLS route-coverage guard (#1838).
 *
 * RLS tenant isolation is only enforced for queries that run inside a
 * withPinnedConnection scope. withApiRoute()/withTenantScope() (lib/api/with-api-route.ts)
 * establish that scope for a whole handler. A tenant API route that authenticates
 * (requireAuth / requireTenantCtx) and then runs its own `db` queries WITHOUT being
 * wrapped runs those queries on unpinned connections with an empty tenant GUC —
 * RLS provides no isolation there, so a single missing app-level tenantId filter
 * becomes a cross-tenant leak.
 *
 * This guard fails CI when any file under app/api/tenant/** :
 *   - authenticates (requireAuth or requireTenantCtx), AND
 *   - runs a db.* query, AND
 *   - is NOT wrapped in withApiRoute / withTenantScope.
 *
 * Public/webhook/callback routes that never authenticate are unaffected.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'app/api/tenant';

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

const files = walk(ROOT);

const AUTH_RE = /\b(requireAuth|requireTenantCtx)\b/;
const DB_RE = /\bdb\.(select|insert|update|delete|query|execute|transaction)\b/;
// Must be USED (called as a wrapper), not merely imported — so a route that
// imports withApiRoute but exports a bare handler is still caught.
const WRAP_USED_RE = /\b(withApiRoute|withTenantScope)\s*\(/;
// A bare handler export that is NOT going through a wrapper.
const BARE_EXPORT_RE = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/;

const offenders = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  if (!AUTH_RE.test(src) || !DB_RE.test(src)) continue;
  const wrapped = WRAP_USED_RE.test(src);
  const hasBareExport = BARE_EXPORT_RE.test(src);
  // Offender if it never actually calls a wrapper, OR it still exports a bare
  // `export async function GET/POST/...` handler (which bypasses the wrapper).
  if (!wrapped || hasBareExport) {
    offenders.push(file);
  }
}

if (offenders.length > 0) {
  console.error(
    '\n\u001b[31m✖ RLS route-coverage guard failed (#1838).\u001b[0m\n' +
      '\n' +
      '  The following tenant API routes authenticate and run db queries but are\n' +
      '  NOT wrapped in withApiRoute()/withTenantScope(). Their queries run outside\n' +
      '  the pinned-connection scope, so RLS does not isolate them and a missing\n' +
      '  app-level tenantId filter would leak across tenants.\n\n' +
      offenders.map((f) => `    - ${f}`).join('\n') +
      '\n\n' +
      '  Fix: wrap the handler, e.g.\n' +
      '    export const GET = withApiRoute(async (request) => { ... });\n',
  );
  process.exit(1);
}

console.log(`[check-rls-route-coverage] OK — ${files.length} tenant routes scanned, all authenticated ones are wrapped.`);
