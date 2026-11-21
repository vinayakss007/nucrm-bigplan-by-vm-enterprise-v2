/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the SSO callback reactivated a lapsed membership with
 * `WHERE id = <member>` only. The status read above is unlocked, so an admin
 * removing that member in the gap had the removal silently undone by the next
 * SSO login. The write now goes through the shared transition helper with the
 * reactivable from-set, which also adds the tenant + tombstone gate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/auth/sso/callback/route.ts'), 'utf8');

describe('#3407: SSO membership reactivation claims its from-state', () => {
  it('claims the lapsed from-set through the shared helper', () => {
    const idx = src.indexOf('await transitionStatus(tx, {');
    expect(idx).toBeGreaterThan(-1);
    const tail = src.slice(idx, idx + 600);
    expect(tail).toMatch(/table: tenantMembers/);
    expect(tail).toMatch(/tenantId: args\.tenantId,/);
    expect(tail).toMatch(/from: \['invited', 'pending', 'suspended'\]/);
    expect(tail).toMatch(/to: 'active'/);
  });

  it('does not reactivate a row by id alone', () => {
    expect(src).not.toMatch(/\.update\(tenantMembers\)[\s\S]{0,200}status: 'active'/);
  });

  it('fails closed when the claim is lost in a concurrent write', () => {
    expect(src).toMatch(/if \(!reactivated\.ok\) throw new ConcurrencyError\('Membership'\)/);
  });

  it('still refuses to reactivate an explicitly removed member', () => {
    // The from-set deliberately excludes 'removed' — an admin's deliberate
    // removal must not be undone by SSO.
    expect(src).toMatch(/existingMember\.status !== 'active' && existingMember\.status !== 'removed'/);
  });
});
