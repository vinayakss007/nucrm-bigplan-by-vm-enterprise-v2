/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 A2 — the Record Permissions tab could list grants but nothing could
 * create one: `grantRecordAccess`/`revokeRecordAccess` had no production
 * caller. This pins the admin-only, tenant-scoped writer API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const TENANT = '11111111-1111-4111-8111-111111111111';
const ROLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockRequireAuth = vi.fn();
const h = vi.hoisted(() => ({
  roleRows: [] as unknown[],
  grants: [] as Record<string, unknown>[],
  revokes: [] as unknown[][],
  expiresUpdates: [] as unknown[],
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: (...args: unknown[]) => mockRequireAuth(...args) };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C,>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => {
      const b: Record<string, unknown> = {};
      b.from = () => b;
      b.where = () => b;
      b.limit = () => Promise.resolve(h.roleRows);
      return b;
    },
    update: () => {
      const b: Record<string, unknown> = {};
      b.set = (v: unknown) => { h.expiresUpdates.push(v); return b; };
      b.where = () => Promise.resolve([]);
      return b;
    },
  },
}));
vi.mock('@/lib/rbac/record-permissions', () => ({
  grantRecordAccess: (...args: unknown[]) => {
    h.grants.push({ args });
    return Promise.resolve({ id: 'grant-1', ...args });
  },
  revokeRecordAccess: (...args: unknown[]) => {
    h.revokes.push(args);
    return Promise.resolve();
  },
}));

import { POST, DELETE } from '@/app/api/tenant/rbac/record-permissions/route';

const URL = 'http://localhost:3000/api/tenant/rbac/record-permissions';
const asAdmin = () => mockRequireAuth.mockResolvedValue({
  userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tenantId: TENANT,
  isAdmin: true, isSuperAdmin: false, roleSlug: 'admin',
});
const asRep = () => mockRequireAuth.mockResolvedValue({
  userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tenantId: TENANT,
  isAdmin: false, isSuperAdmin: false, roleSlug: 'rep',
});
const post = (body: unknown) => new NextRequest(URL, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
const del = (roleId: string, entityType: string, entityId: string) =>
  new NextRequest(`${URL}?role_id=${roleId}&entity_type=${entityType}&entity_id=${entityId}`, { method: 'DELETE' });
const valid = {
  role_id: ROLE, entity_type: 'deals', entity_id: DEAL, access_level: 'read',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.roleRows = []; h.grants = []; h.revokes = []; h.expiresUpdates = [];
});

describe('POST /api/tenant/rbac/record-permissions (#2597 A2)', () => {
  it('refuses a non-admin before validation', async () => {
    asRep();
    const res = (await POST(post(valid), {} as never)) as NextResponse;
    expect(res.status).toBe(403);
    expect(h.grants).toHaveLength(0);
  });

  it('rejects an unsupported entity or access level', async () => {
    asAdmin();
    expect((await POST(post({ ...valid, entity_type: 'everything' }), {} as never)) as NextResponse)
      .toHaveProperty('status', 400);
    expect((await POST(post({ ...valid, access_level: 'owner' }), {} as never)) as NextResponse)
      .toHaveProperty('status', 400);
    expect(h.grants).toHaveLength(0);
  });

  it('404s a role outside the tenant before granting', async () => {
    asAdmin();
    h.roleRows = [];
    const res = (await POST(post(valid), {} as never)) as NextResponse;
    expect(res.status).toBe(404);
    expect(h.grants).toHaveLength(0);
  });

  it('grants to the caller tenant and returns 201', async () => {
    asAdmin();
    h.roleRows = [{ id: ROLE }];
    const res = (await POST(post(valid), {} as never)) as NextResponse;
    expect(res.status).toBe(201);
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]!.args).toEqual([TENANT, ROLE, 'deals', DEAL, 'read', expect.any(String)]);
    expect(h.expiresUpdates).toHaveLength(0);
  });

  it('applies an expiry when supplied (the lib writer does not)', async () => {
    asAdmin();
    h.roleRows = [{ id: ROLE }];
    const res = (await POST(post({ ...valid, expires_at: '2030-01-01T00:00:00.000Z' }), {} as never)) as NextResponse;
    expect(res.status).toBe(201);
    expect(h.expiresUpdates).toHaveLength(1);
  });
});

describe('DELETE /api/tenant/rbac/record-permissions (#2597 A2)', () => {
  it('refuses a non-admin', async () => {
    asRep();
    const res = (await DELETE(del(ROLE, 'deals', DEAL), {} as never)) as NextResponse;
    expect(res.status).toBe(403);
    expect(h.revokes).toHaveLength(0);
  });

  it('validates ids and entity type', async () => {
    asAdmin();
    expect((await DELETE(del('not-a-uuid', 'deals', DEAL), {} as never)) as NextResponse)
      .toHaveProperty('status', 400);
    expect((await DELETE(del(ROLE, 'everything', DEAL), {} as never)) as NextResponse)
      .toHaveProperty('status', 400);
    expect(h.revokes).toHaveLength(0);
  });

  it('revokes with the caller tenant', async () => {
    asAdmin();
    const res = (await DELETE(del(ROLE, 'deals', DEAL), {} as never)) as NextResponse;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.revokes).toEqual([[TENANT, ROLE, 'deals', DEAL]]);
  });
});
