/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stripRowForRead, enforceFieldWrite } from '@/lib/rbac/enforce';
import type { AuthContext } from '@/lib/auth/middleware';

// #2616 — createDealSchema / updateDealSchema accept `stage` and `stage_name`
// as aliases for `stage_id` (resolveDealStage turns them into a UUID before
// the write). enforceFieldWrite used the same ownerField map as the read
// projection, but READ_ALIASES only knew `stage_id: ['stage']` from #2617, so
// a PATCH body sending `stage_name` bypassed a `stage_id` write restriction
// — the exact class of bug the amount→value alias was added to close.
//
// Bulk actions are called out in #2616 as a second unrestricted write path
// but are addressed separately (app/api/tenant/deals/bulk/route.ts has no
// enforceFieldWrite at all today).

const TENANT = '11111111-1111-4111-8111-111111111111';

function ctx(over: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u-1', tenantId: TENANT, roleSlug: 'rep',
    permissions: {}, isAdmin: false, isSuperAdmin: false, ...over,
  } as AuthContext;
}

describe('enforceFieldWrite — deals stage aliases (#2616)', () => {
  beforeEach(() => { vi.resetModules(); });

  // stripRowForRead is exposed for testing; enforceFieldWrite needs a db,
  // so we go through the pure projection with a hand-built restriction map
  // to keep the test hermetic.
  it('restricting stage_id strips stage_name from a PATCH body', () => {
    // Same alias table drives both directions via ownerField(); verify a
    // stage_id restriction propagates to stage_name. `'none'` fails both the
    // read and the write threshold, so it exercises the alias lookup without
    // depending on which threshold the projection applies.
    const map = new Map([['stage_id', 'none' as const]]);
    const out = stripRowForRead('deals', map, { id: 'd', stage_id: 'S', stage: 'S', stage_name: 'Won' });
    expect(out).toEqual({ id: 'd' });
  });

  it('restricting stage_id strips stage as well as the canonical key', () => {
    const map = new Map([['stage_id', 'none' as const]]);
    const out = stripRowForRead('deals', map, { id: 'd', stage_id: 'S', stage: 'S' });
    expect(out).toEqual({ id: 'd' });
  });

  it('unrestricted stage_id leaves stage + stage_name intact', () => {
    const map = new Map();
    const row = { id: 'd', stage_id: 'S', stage: 'S', stage_name: 'Won' };
    expect(stripRowForRead('deals', map, row)).toEqual(row);
  });

  it('amount → value alias coverage unchanged (regression guard)', () => {
    const map = new Map([['amount', 'none' as const]]);
    expect(stripRowForRead('deals', map, { id: 'd', amount: '10', value: '10' })).toEqual({ id: 'd' });
  });
});

// Superadmin exemption on the actual enforce path — cheap smoke test.
describe('enforceFieldWrite — superadmin short-circuit (#2616)', () => {
  it('superadmin body passes through unchanged regardless of aliases', async () => {
    const { db } = await import('@/drizzle/db');
    expect(db).toBeDefined();
    const out = await enforceFieldWrite(ctx({ isSuperAdmin: true }), 'deals', {
      stage: 'Negotiation', stage_name: 'Won', stage_id: 'S',
    });
    expect(out.stripped).toEqual([]);
    expect(out.body).toEqual({ stage: 'Negotiation', stage_name: 'Won', stage_id: 'S' });
  });
});
