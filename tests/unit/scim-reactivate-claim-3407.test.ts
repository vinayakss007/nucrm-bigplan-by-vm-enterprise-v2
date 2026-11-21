/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — SCIM provisioning reactivated an inactive member with `WHERE id`
 * alone, so a concurrent deactivation landed after the read was stomped back to
 * active. The write now goes through the shared transition owner with a tenant
 * + from-state + tombstone claim, and a lost claim is an idempotent no-op.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/scim/v2/Users/route.ts'), 'utf8');

describe('#3407: SCIM reactivation goes through the single transition owner', () => {
  it('claims inactive→active with the tenant and registry from-states', () => {
    const idx = src.indexOf('await transitionStatus(tx, {');
    expect(idx).toBeGreaterThan(-1);
    const tail = src.slice(idx, idx + 520);
    expect(tail).toMatch(/table: tenantMembers/);
    expect(tail).toMatch(/tenantId,/);
    expect(tail).toMatch(/transitionFrom\('tenantMembers', 'active'\)/);
    expect(tail).toMatch(/to: 'active'/);
  });

  it('no longer does a bare id-only status update for reactivation', () => {
    const old = src.indexOf(".set({ status: 'active', updatedAt: new Date() })");
    expect(old).toBe(-1);
  });
});
