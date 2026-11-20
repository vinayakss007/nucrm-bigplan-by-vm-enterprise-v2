/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — the SSO callback reactivated a lapsed membership with
 * `WHERE id = <member>` only. The status read above is unlocked, so an admin
 * removing that member in the gap had the removal silently undone by the next
 * SSO login. The write now claims the reactivable from-set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/auth/sso/callback/route.ts'), 'utf8');

describe('#3407: SSO membership reactivation claims its from-state', () => {
  it('does not reactivate a row by id alone', () => {
    const idx = src.indexOf(".set({ status: 'active', updatedAt: new Date() })");
    expect(idx).toBeGreaterThan(-1);
    const tail = src.slice(idx, idx + 520);
    expect(tail).toMatch(/inArray\(tenantMembers\.status,\s*\['invited', 'pending', 'suspended'\]\)/);
    expect(tail).toMatch(/eq\(tenantMembers\.id, existingMember\.id\)/);
    expect(tail).toMatch(/\.returning\(/);
  });

  it('fails closed when the claim is lost in a concurrent write', () => {
    expect(src).toMatch(/if \(!reactivated\.length\) throw new ConcurrencyError\('Membership'\)/);
  });

  it('still refuses to reactivate an explicitly removed member', () => {
    // The from-set deliberately excludes 'removed' — an admin's deliberate
    // removal must not be undone by SSO.
    expect(src).toMatch(/existingMember\.status !== 'active' && existingMember\.status !== 'removed'/);
  });
});
