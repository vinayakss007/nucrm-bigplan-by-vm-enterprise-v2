/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2221 — GET /api/flags honored the spoofable X-Tenant-ID header after only
 * verifying the session, with no tenant_members check (the gateway validates
 * the same header in lib/api/gateway.ts). Any authenticated user could pass
 * another tenant's id and enumerate its flag overrides / kill-switch state.
 * The route now rejects X-Tenant-ID values the caller is not an active member
 * of with 403. Client-IP handling goes through the central TRUST_PROXY-gated
 * helper inside checkRateLimit (mocked here), so no new IP surface exists.
 *
 * #3288 rewrote the cookie branch of this route: it used to `verifyToken` the
 * JWT and then read `sessions` on the bare pool to recover the user id, which
 * under FORCE RLS matched zero rows, so the branch could never authenticate
 * anybody. Both branches now redeem the credential through
 * getCurrentUserForToken, which is why the cookie cases below mock that helper
 * instead of a sessions SELECT. The #2221 guarantee being tested here —
 * membership, not the header, authorizes a tenant — is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const { mockGetAllFlags, mockCheckRateLimit, mockGetCurrentUserForToken, dbSelect } =
  vi.hoisted(() => ({
    mockGetAllFlags: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockGetCurrentUserForToken: vi.fn(),
    dbSelect: vi.fn(),
  }));

/** Awaitable drizzle chain: select().from().where().limit(1) -> rows. */
function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
  };
  chain.limit = () => Promise.resolve(rows);
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(rows);
  return chain;
}

/** Queue the rows the tenant_members probe returns. */
function queueSelects(...rowSets: unknown[][]) {
  let i = 0;
  dbSelect.mockImplementation(() => makeChain(rowSets[Math.min(i++, rowSets.length - 1)] ?? []));
}

vi.mock('@/lib/flags', () => ({ getAllFlags: (...args: unknown[]) => mockGetAllFlags(...args) }));
vi.mock('@/drizzle/db', () => ({ db: { select: (...args: unknown[]) => dbSelect(...args) } }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
// Both credential branches of the route redeem through this one helper (#2216 for
// the bearer path, #3288 for the cookie path), so it is the only session export
// the route reaches any more.
vi.mock('@/lib/auth/session', () => ({
  getCurrentUserForToken: (...args: unknown[]) => mockGetCurrentUserForToken(...args),
}));

import { GET } from '@/app/api/flags/route';

function flagsRequest(headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/flags', { headers });
}

describe('GET /api/flags — X-Tenant-ID membership gate (#2221)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue(null);
    mockGetAllFlags.mockResolvedValue([{ key: 'dashboard-v2', enabled: true }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 403 for an authenticated user claiming a foreign X-Tenant-ID they are not a member of', async () => {
    // TRUST_PROXY on: the header is client-supplied either way — membership
    // (not IP provenance) is what authorizes tenant context.
    vi.stubEnv('TRUST_PROXY', 'true');
    mockGetCurrentUserForToken.mockResolvedValue({ id: 'user-1' });
    // The only select left on the cookie path is the tenant_members probe, and it
    // finds nothing for a foreign tenant.
    queueSelects([]);

    const res = await GET(flagsRequest({ cookie: 'nucrm_session=abc', 'x-tenant-id': TENANT_B }));
    expect(res.status).toBe(403);
    expect(mockGetAllFlags).not.toHaveBeenCalled();
  });

  it('serves tenant overrides when the caller IS an active member of the claimed tenant', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    mockGetCurrentUserForToken.mockResolvedValue({ id: 'user-1' });
    queueSelects([{ id: 'member-row' }]);

    const res = await GET(flagsRequest({ cookie: 'nucrm_session=abc', 'x-tenant-id': TENANT_A }));
    expect(res.status).toBe(200);
    expect(mockGetAllFlags).toHaveBeenCalledWith({ tenantId: TENANT_A, userId: 'user-1' });
    const body = await res.json();
    expect(body.flags['dashboard-v2']).toBe(true);
  });

  it('bearer path: no X-Tenant-ID header still works and skips the membership query', async () => {
    vi.stubEnv('TRUST_PROXY', 'false');
    mockGetCurrentUserForToken.mockResolvedValue({ id: 'user-1' });

    const res = await GET(flagsRequest({ authorization: 'Bearer jwt-token' }));
    expect(res.status).toBe(200);
    expect(mockGetAllFlags).toHaveBeenCalledWith({ tenantId: undefined, userId: 'user-1' });
    expect(dbSelect).not.toHaveBeenCalled();
  });

  it('bearer path: foreign X-Tenant-ID is 403 too (membership checked for both auth styles)', async () => {
    mockGetCurrentUserForToken.mockResolvedValue({ id: 'user-1' });
    // The membership query is the only select on this path — empty rows must reject.
    queueSelects([]);

    const res = await GET(flagsRequest({ authorization: 'Bearer jwt-token', 'x-tenant-id': TENANT_B }));
    expect(res.status).toBe(403);
    expect(mockGetAllFlags).not.toHaveBeenCalled();
  });

  it('anonymous callers still get the empty map (unchanged #1150 contract)', async () => {
    const res = await GET(flagsRequest({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ flags: {} });
    expect(mockGetAllFlags).not.toHaveBeenCalled();
  });
});
