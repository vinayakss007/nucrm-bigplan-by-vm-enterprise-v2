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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const { mockGetAllFlags, mockCheckRateLimit, mockVerifyToken, mockHashToken, mockGetCurrentUserForToken, dbSelect } =
  vi.hoisted(() => ({
    mockGetAllFlags: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    mockVerifyToken: vi.fn(),
    mockHashToken: vi.fn(),
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

/** Queue the rows returned by successive db.select() calls (sessions, then members). */
function queueSelects(...rowSets: unknown[][]) {
  let i = 0;
  dbSelect.mockImplementation(() => makeChain(rowSets[Math.min(i++, rowSets.length - 1)] ?? []));
}

vi.mock('@/lib/flags', () => ({ getAllFlags: (...args: unknown[]) => mockGetAllFlags(...args) }));
vi.mock('@/drizzle/db', () => ({ db: { select: (...args: unknown[]) => dbSelect(...args) } }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
// Session mock exports BOTH verifyToken (cookie path) and
// getCurrentUserForToken (#2216 bearer path) per repo test convention.
vi.mock('@/lib/auth/session', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  hashToken: (...args: unknown[]) => mockHashToken(...args),
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
    mockHashToken.mockResolvedValue('token-hash');
    mockGetAllFlags.mockResolvedValue([{ key: 'dashboard-v2', enabled: true }]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 403 for an authenticated user claiming a foreign X-Tenant-ID they are not a member of', async () => {
    // TRUST_PROXY on: the header is client-supplied either way — membership
    // (not IP provenance) is what authorizes tenant context.
    vi.stubEnv('TRUST_PROXY', 'true');
    mockVerifyToken.mockResolvedValue({ userId: 'user-1' });
    // sessions lookup finds the row; tenant_members lookup finds nothing.
    queueSelects([{ userId: 'user-1' }], []);

    const res = await GET(flagsRequest({ cookie: 'nucrm_session=abc', 'x-tenant-id': TENANT_B }));
    expect(res.status).toBe(403);
    expect(mockGetAllFlags).not.toHaveBeenCalled();
  });

  it('serves tenant overrides when the caller IS an active member of the claimed tenant', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    mockVerifyToken.mockResolvedValue({ userId: 'user-1' });
    queueSelects([{ userId: 'user-1' }], [{ id: 'member-row' }]);

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
    queueSelects([{ id: 'member-row-not-used' }], []);
    // First select IS the membership query here (bearer path has no sessions
    // lookup) — empty rows must reject.
    dbSelect.mockImplementationOnce(() => makeChain([]));

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
