/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407 — `DELETE /api/scim/v2/Users/:id` soft-deleted the tenant membership
 * with `WHERE id = ...` only. The unlocked read above could be invalidated in
 * the gap, and the response claimed a deprovision that did not happen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../..');
const src = readFileSync(join(ROOT, 'app/api/scim/v2/Users/[id]/route.ts'), 'utf8');

describe('#3407: SCIM deprovision claims the live from-state', () => {
  it('re-asserts tenant and a live from-state in the deactivate write', () => {
    const idx = src.indexOf(".set({ status: 'inactive', updatedAt: new Date() })");
    expect(idx).toBeGreaterThan(-1);
    const tail = src.slice(idx, idx + 560);
    expect(tail).toMatch(/eq\(tenantMembers\.tenantId, tenantId\)/);
    expect(tail).toMatch(/ne\(tenantMembers\.status, 'inactive'\)/);
    expect(tail).toMatch(/\.returning\(/);
  });

  it('fails closed when the claim loses the race', () => {
    expect(src).toMatch(/if \(!deactivated\.length\) throw NextResponse\.json\(/);
  });
});
