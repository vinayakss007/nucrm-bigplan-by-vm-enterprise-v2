/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Field-permission enforcement guard (#2597).
 *
 * #2597 was not a missing-feature bug — the enforcement library
 * (`lib/rbac/enforce.ts`) always existed and its unit tests were green. It was
 * a missing-*wire* bug: not one production route called it, so an admin could
 * hide `amount` on deals from role `rep`, get a success toast, and the deals API
 * kept returning `amount`. A green test suite proved the lib worked; nothing
 * proved anyone used it.
 *
 * The five entities were wired up in #2647 (leads, contacts) and #2649
 * (companies, tasks), joining the deals routes that already projected through
 * the enforce layer. This guard is the last bullet of #2597's "tests the fix
 * needs": fail CI when an entity route stops enforcing field permissions, so
 * the enforcement cannot silently rot back into the dead-code state that hid
 * the original defect.
 *
 * The contract it pins, per entity route pair (list + [id] handler) — the exact
 * set the admin UI's Field Permissions tab writes configuration for:
 *
 *   - the file imports from `@/lib/rbac/enforce`, and
 *   - it calls `enforceFieldRead(`  (the GET projection), and
 *   - it calls `enforceFieldWrite(` (the POST/PATCH body gate).
 *
 * Scope notes, deliberate:
 *   - This checks that a route *consults* the enforce layer, not that it does
 *     so on every code path. Deep per-handler coverage lives in the route unit
 *     tests (e.g. tests/unit/field-coverage-companies-tasks-2618.test.ts); a
 *     call-site guard is the cheap, un-rottable complement that catches the
 *     whole-layer-removed regression #2597 actually shipped as.
 *   - The bulk/import/export sub-routes are not enumerated here: their doctrine
 *     differs (403 on a restricted bulk column, per-row strip on import/export),
 *     so a blanket "must call enforceFieldWrite" would be wrong for them. They
 *     are pinned by their own route tests instead.
 *
 * Usage (from the repo root): node scripts/check-field-permission-enforcement.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** The entity route pairs whose responses a Field-Permissions row can shape. */
const ENFORCED_ROUTES = [
  'app/api/tenant/deals/route.ts',
  'app/api/tenant/deals/[id]/route.ts',
  'app/api/tenant/leads/route.ts',
  'app/api/tenant/leads/[id]/route.ts',
  'app/api/tenant/contacts/route.ts',
  'app/api/tenant/contacts/[id]/route.ts',
  'app/api/tenant/companies/route.ts',
  'app/api/tenant/companies/[id]/route.ts',
  'app/api/tenant/tasks/route.ts',
  'app/api/tenant/tasks/[id]/route.ts',
];

/**
 * Pure — inspect one route's source against the enforcement contract. Returns
 * the list of problems (empty when the route enforces as expected).
 */
export function checkEnforcement(file, src) {
  const problems = [];
  if (!src.includes(`from '@/lib/rbac/enforce'`)) {
    problems.push(`${file} does not import @/lib/rbac/enforce — field permissions are not consulted here (#2597).`);
  }
  if (!/enforceFieldRead\(/.test(src)) {
    problems.push(`${file} never calls enforceFieldRead(...) — its GET can still leak a field an admin hid (#2597).`);
  }
  if (!/enforceFieldWrite\(/.test(src)) {
    problems.push(`${file} never calls enforceFieldWrite(...) — a POST/PATCH can still accept a field an admin locked (#2597).`);
  }
  return problems;
}

/** Pure — run the contract over every route pair given an injected reader. */
export function runGuard(routes, readFile) {
  const problems = [];
  for (const file of routes) {
    let src;
    try {
      src = readFile(file);
    } catch {
      problems.push(`${file} listed as an enforced route but is not readable — it was renamed or deleted without updating this guard (#2597).`);
      continue;
    }
    problems.push(...checkEnforcement(file, src));
  }
  return { problems, checked: routes.length };
}

function main() {
  const { problems, checked } = runGuard(ENFORCED_ROUTES, (file) => readFileSync(file, 'utf8'));
  if (problems.length > 0) {
    console.error(
      `\n[check-field-permission-enforcement] FAIL — ${problems.length} problem(s):\n\n` +
        problems.map((p) => `    - ${p}`).join('\n') +
        '\n',
    );
    process.exit(1);
  }
  console.log(
    `[check-field-permission-enforcement] OK — ${checked} entity route pairs all consult @/lib/rbac/enforce ` +
      `for both read and write (#2597).`,
  );
}

// CLI only when invoked directly, so unit tests can import the pure logic.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
