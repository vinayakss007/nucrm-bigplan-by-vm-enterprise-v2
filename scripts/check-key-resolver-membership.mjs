#!/usr/bin/env node
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Credential-resolver membership guard (#3291 ask 4).
 *
 * The issue put the invariant this checks: "Three of the four branches in one
 * function already do [prove membership], which is the clearest possible sign that
 * this was an oversight rather than a design." `resolveGatewayTenant()` proved the
 * caller still belongs to the workspace on the header, custom-domain and subdomain
 * branches — and returned immediately on the API-key branch, which was the only
 * branch that did not. The strongest credential in the system had the weakest
 * check, so removing a member killed their sessions (middleware.ts re-checks per
 * cookie request) while `PATCH`-`remove` left `/api/v1/**` open to their key.
 *
 * Three denominators, measured on this tree rather than assumed:
 *
 *   1. EVERY file under app/ or lib/ that resolves a request from
 *      `apiKeys.keyHash` must prove the key's owner holds an active membership —
 *      either by calling the shared proof (`keyOwnerIsLive` / `hasActiveMembership`)
 *      or by carrying the predicate itself. This is a *tree-wide* denominator, not
 *      the `lib/api/**` one the issue named: the resolver the issue was about lives
 *      in lib/auth/, and a screen scoped to lib/api/** would have scanned zero
 *      files and printed OK.
 *   2. The shared proof module must still carry the predicate it exists to enforce
 *      (`status = 'active'` AND not soft-deleted). Without this, denominator 1
 *      would keep passing while the proof quietly became `!= 'removed'`.
 *   3. `lib/api/gateway.ts` must keep one membership predicate per tenant-resolution
 *      branch, counted from the file's own `source: '…'` shape. A fourth branch that
 *      forgets the check — the exact mistake #3291 was — fails here.
 *
 * A resolver count of zero is a failure, not a pass: the scan stopped matching
 * something, which is how a guard ends up asserting nothing (#3302's lesson).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROOF_MODULE = 'lib/auth/api-key-membership.ts';
const GATEWAY = 'lib/api/gateway.ts';
const CREDENTIAL_RE = /\bapiKeys\.keyHash\b/;
const PROOF_CALL_RE = /\b(keyOwnerIsLive|hasActiveMembership)\s*\(/;
// Two forms on purpose: a /g regex is stateful across .test() calls, and this file
// tests it against one source per resolver.
const MEMBERSHIP_PREDICATE = /eq\(\s*tenantMembers\.status,\s*'active'\s*\)/;
const MEMBERSHIP_PREDICATE_G = new RegExp(MEMBERSHIP_PREDICATE.source, 'g');

/**
 * Files permitted to resolve a key without proving membership. Every entry needs a
 * written reason, in this file, next to the path — an entry without one is a hole
 * with a name on it. Empty by design: all three resolvers prove today.
 */
const EXEMPT = new Map();

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = [...walk('app', []), ...walk('lib', [])];
const resolvers = files.filter((f) => CREDENTIAL_RE.test(readFileSync(f, 'utf8')));

const problems = [];
for (const file of resolvers) {
  if (EXEMPT.has(file)) continue;
  const src = readFileSync(file, 'utf8');
  const proves = PROOF_CALL_RE.test(src) || MEMBERSHIP_PREDICATE.test(src);
  if (!proves) {
    problems.push(
      `${file} authenticates a request from apiKeys.keyHash and never proves the ` +
      `owner still holds an active membership.\n` +
      `    Fix: await setTenantContext(<key tenant>, …) then gate on ` +
      `keyOwnerIsLive(tenantId, userId) — the read must run AFTER the tenant is ` +
      `adopted, because tenant_members is tenant-isolated (see ` +
      `${PROOF_MODULE}).`,
    );
  }
}

if (resolvers.length === 0) {
  problems.push(
    'this guard found no resolver of apiKeys.keyHash anywhere under app/ or lib/. ' +
    'Either the credential lookup was renamed (update CREDENTIAL_RE) or the scan no ' +
    'longer covers the tree it was written for. A screen with an empty denominator ' +
    'asserts nothing (#3302).',
  );
}

if (!existsSync(PROOF_MODULE)) {
  problems.push(`${PROOF_MODULE} is gone — the resolvers above are sharing nothing.`);
} else {
  const proofSrc = readFileSync(PROOF_MODULE, 'utf8');
  if (!MEMBERSHIP_PREDICATE.test(proofSrc)) {
    problems.push(`${PROOF_MODULE} no longer requires status = 'active'; the proof has been weakened.`);
  }
  if (!/isNull\(\s*tenantMembers\.deletedAt\s*\)/.test(proofSrc)) {
    problems.push(`${PROOF_MODULE} no longer excludes a soft-deleted membership row.`);
  }
  if (!/tenantMembers\.tenantId/.test(proofSrc) || !/tenantMembers\.userId/.test(proofSrc)) {
    problems.push(`${PROOF_MODULE} must scope the proof to the key's own tenant and owner.`);
  }
}

if (!existsSync(GATEWAY)) {
  problems.push(`${GATEWAY} is gone — the branch count below is meaningless.`);
} else {
  const gw = readFileSync(GATEWAY, 'utf8');
  const sources = [...gw.matchAll(/\bsource:\s*'[a-z_]+'/g)].map((m) => m[0]);
  const keyBranches = [...gw.matchAll(/\bsource:\s*'api_key'/g)].length;
  const predicates = (gw.match(MEMBERSHIP_PREDICATE_G) ?? []).length;
  const needingOwn = sources.length - keyBranches;
  if (predicates < needingOwn) {
    problems.push(
      `${GATEWAY} resolves ${sources.length} tenant(s) (${needingOwn} of them not via ` +
      `tryApiKeyAuth) but carries only ${predicates} membership predicate(s). Every ` +
      `resolution branch that is not the API-key branch must prove ` +
      `tenantMembers.status = 'active' for the resolved user — that is the check the ` +
      `key branch was missing when #3291 was filed.`,
    );
  }
}

if (problems.length > 0) {
  console.error('\n\x1b[31m✖ credential-resolver membership guard failed (#3291).\x1b[0m\n');
  for (const p of problems) console.error(`  ${p}\n`);
  console.error(`  Resolvers scanned: ${resolvers.length}\n    ${resolvers.join('\n    ')}\n`);
  process.exit(1);
}

console.log(
  `[check-key-resolver-membership] OK — ${resolvers.length} resolver(s) of ` +
    `apiKeys.keyHash, all proving an active membership (${resolvers.join(', ')}); ` +
    `gateway carries ${(existsSync(GATEWAY) ? readFileSync(GATEWAY, 'utf8').match(MEMBERSHIP_PREDICATE_G) ?? [] : []).length} ` +
    `membership predicate(s) over its resolution branches.`,
);
