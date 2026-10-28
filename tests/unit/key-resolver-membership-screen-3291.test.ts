/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3291 ask 4 — the screen over credential resolvers.
 *
 * The behaviour is pinned in api-key-membership-3291.test.ts (tryApiKeyAuth),
 * api-key-resolver-membership-3291.test.ts (the other two resolvers) and
 * api-key-revocation-on-offboard-3291.test.ts (offboarding). This spec pins the
 * guarantee that keeps them from rotting: any file that authenticates a request
 * from `apiKeys.keyHash` must prove an active membership, the shared proof must
 * keep meaning that, and `resolveGatewayTenant()` must keep one predicate per
 * resolution branch.
 *
 * Each case plants one problem in a throwaway tree, because a guard that has never
 * been seen to fail is not evidence of anything. The last case runs it against the
 * real tree — that is what makes the screen a check rather than a description.
 *
 * Enforced from `test-unit` (this spec shells out to the script) rather than a new
 * `guard:` job: the cited coordinates in `.github/workflows/ci.yml` are load-bearing
 * for docs/infra/PREPROD-ISSUE-REGISTER.md, and inserting a step would shift every
 * one of them below the insertion point.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-key-resolver-membership.mjs');

const PROOF_MODULE = `
import { and, eq, isNull } from 'drizzle-orm';
export async function hasActiveMembership(tx, tenantId, userId) {
  const [member] = await tx.select({ id: tenantMembers.id }).from(tenantMembers)
    .where(and(
      eq(tenantMembers.tenantId, tenantId),
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.status, 'active'),
      isNull(tenantMembers.deletedAt),
    )).limit(1);
  return Boolean(member);
}
export async function keyOwnerIsLive(tenantId, userId) { return true; }
`;

const PROVING_RESOLVER = `
import { keyOwnerIsLive } from '@/lib/auth/api-key-membership';
export async function tryApiKeyAuth(request) {
  const row = await tx.select().from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));
  await setTenantContext(row.tenantId, row.userId);
  if (!await keyOwnerIsLive(row.tenantId, row.userId)) return null;
  return ctx;
}
`;

const UNPROVEN_RESOLVER = `
export async function tryApiKeyAuth(request) {
  const row = await tx.select().from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)));
  return ctx;
}
`;

const GATEWAY = `
export async function resolveGatewayTenant(request) {
  const apiKeyCtx = await tryApiKeyAuth(request);
  if (apiKeyCtx) return { tenantId: apiKeyCtx.tenantId, source: 'api_key' };
  if (header) {
    const m = await db.select({ id: tenantMembers.id }).from(tenantMembers).where(and(
      eq(tenantMembers.tenantId, header), eq(tenantMembers.userId), eq(tenantMembers.status, 'active'))).limit(1);
    return { tenantId: header, source: 'header' };
  }
  if (domain) {
    const m = await db.select().from(tenantMembers).where(and(eq(tenantMembers.status, 'active')));
    return { tenantId: domain, source: 'domain' };
  }
  if (sub) {
    const m = await db.select().from(tenantMembers).where(and(eq(tenantMembers.status, 'active')));
    return { tenantId: sub, source: 'subdomain' };
  }
  return null;
}
`;

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'key-resolver-3291-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

function run(cwd: string) {
  return spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' });
}

describe('check-key-resolver-membership.mjs fails what it claims (#3291 ask 4)', () => {
  it('fails a resolver that authenticates from keyHash and proves nothing', () => {
    const dir = fixture({
      'lib/auth/api-key-membership.ts': PROOF_MODULE,
      'lib/api/gateway.ts': GATEWAY,
      'lib/auth/api-key.ts': UNPROVEN_RESOLVER,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('lib/auth/api-key.ts');
    expect(res.stderr).toContain('never proves the owner still holds an active membership');
  });

  it('passes the same resolver once it consults the shared proof', () => {
    const dir = fixture({
      'lib/auth/api-key-membership.ts': PROOF_MODULE,
      'lib/api/gateway.ts': GATEWAY,
      'lib/auth/api-key.ts': PROVING_RESOLVER,
    });
    const res = run(dir);
    expect(res.status, res.stderr).toBe(0);
  });

  it('catches a proof that has been weakened from active to merely-present', () => {
    const dir = fixture({
      'lib/auth/api-key-membership.ts': PROOF_MODULE.replace("eq(tenantMembers.status, 'active'),", ''),
      'lib/api/gateway.ts': GATEWAY,
      'lib/auth/api-key.ts': PROVING_RESOLVER,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("no longer requires status = 'active'");
  });

  it('catches a proof that stopped excluding a soft-deleted membership', () => {
    const dir = fixture({
      'lib/auth/api-key-membership.ts': PROOF_MODULE.replace('isNull(tenantMembers.deletedAt),', ''),
      'lib/api/gateway.ts': GATEWAY,
      'lib/auth/api-key.ts': PROVING_RESOLVER,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('soft-deleted');
  });

  it('counts the gateway branches, so a fourth branch cannot forget the check', () => {
    // Three predicates over three non-key branches is exactly the state #3291 was
    // filed against; drop one predicate and the count rule fires.
    const dir = fixture({
      'lib/auth/api-key-membership.ts': PROOF_MODULE,
      'lib/api/gateway.ts': GATEWAY.replace(
        "const m = await db.select().from(tenantMembers).where(and(eq(tenantMembers.status, 'active')));\n    return { tenantId: sub, source: 'subdomain' };",
        "return { tenantId: sub, source: 'subdomain' };",
      ),
      'lib/auth/api-key.ts': PROVING_RESOLVER,
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('membership predicate(s)');
  });

  it('fails when the scan finds no resolver at all, instead of printing OK', () => {
    // A renamed column would otherwise turn this guard into a green light.
    const dir = fixture({
      'lib/auth/api-key-membership.ts': PROOF_MODULE,
      'lib/api/gateway.ts': GATEWAY,
      'lib/auth/api-key.ts': 'export async function tryApiKeyAuth(r) { return null; }\n',
    });
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('found no resolver');
  });

  it('runs on the real tree and names all three resolvers', () => {
    const res = run(ROOT);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('3 resolver(s) of apiKeys.keyHash');
    for (const file of [
      'lib/auth/api-key.ts',
      'lib/webhooks/inbound-auth.ts',
      'app/api/tenant/visitors/track/route.ts',
    ]) {
      expect(res.stdout, file).toContain(file);
    }
  });
});
