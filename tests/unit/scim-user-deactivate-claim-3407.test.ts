/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — `DELETE /api/scim/v2/Users/:id` used a hand-written from-state claim
 * on the membership write. It now goes through the shared transition owner and
 * the tenant_members registry, so the claim has the same shape as every other
 * status write. The "refuse re-deactivate" rule moved into the registry's
 * active-only from-set for `inactive`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/scim/v2/Users/[id]/route.ts'), 'utf8');

describe('#3407: SCIM deprovision goes through the single transition owner', () => {
  it('claims active→inactive with the tenant and registry from-states', () => {
    // The PATCH path now also uses the helper; target the DELETE deprovision
    // write (the last one in the file) by searching from the delete handler.
    const deleteAt = src.indexOf('export async function DELETE');
    expect(deleteAt).toBeGreaterThan(-1);
    const idx = src.indexOf('await transitionStatus(tx, {', deleteAt);
    expect(idx).toBeGreaterThan(-1);
    const tail = src.slice(idx, idx + 520);
    expect(tail).toMatch(/table: tenantMembers/);
    expect(tail).toMatch(/tenantId,/);
    expect(tail).toMatch(/transitionFrom\('tenantMembers', 'inactive'\)/);
    expect(tail).toMatch(/to: 'inactive'/);
  });

  it('fails closed when the claim loses the race', () => {
    expect(src).toMatch(/if \(!deactivated\.ok\) throw NextResponse\.json\(/);
  });
});
