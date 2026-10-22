/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3001 — custom-field DEFINITION create/update/delete were open to any
 * authenticated member. Definitions are tenant-wide schema config, so the
 * three mutators now require settings.manage, while reads, set-value and
 * set-bulk (per-record values) stay member-open and register-feature keeps
 * its stricter super-admin check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn(async (): unknown => ({
  tenantId: 'tenant-1',
  userId: 'user-1',
  isAdmin: false,
  isSuperAdmin: false,
  permissions: {},
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(h: T) => h,
}));

vi.mock('@/lib/auth/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requireAuth: (request: NextRequest) => mockRequireAuth(request),
    // Mirrors the real can()/requirePerm semantics in lib/auth/middleware.ts.
    requirePerm: (ctx: { isAdmin?: boolean; isSuperAdmin?: boolean; permissions?: Record<string, boolean> }, perm: string) =>
      (ctx.isSuperAdmin || ctx.isAdmin || ctx.permissions?.['all'] === true || ctx.permissions?.[perm] === true)
        ? null
        : NextResponse.json({ error: `Permission denied: ${perm} required` }, { status: 403 }),
  };
});

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      featureRegistry: { findMany: vi.fn(async () => []) },
      customFieldDefs: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
    },
    execute: vi.fn(async () => ({ rows: [{ id: 'lead-1', metadata: {} }] })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 'field-1' }]),
        onConflictDoNothing: vi.fn(async () => []),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'field-1' }]) })),
      })),
    })),
  },
}));

function request(path: string, body?: unknown, method = 'POST'): NextRequest {
  return new Request(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as unknown as NextRequest;
}

const MEMBER = { tenantId: 'tenant-1', userId: 'user-1', isAdmin: false, isSuperAdmin: false, permissions: {} };
const ADMIN = { tenantId: 'tenant-1', userId: 'user-1', isAdmin: true, isSuperAdmin: false, permissions: {} };

const CREATE_BODY = { entityType: 'leads', fieldKey: 'promo_source', fieldLabel: 'Promo Source', fieldType: 'text' };

describe('custom-field definition mutators require settings.manage (#3001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue(MEMBER);
  });

  it('POST create-definition: 403 for member, 201 for admin', async () => {
    const { POST } = await import('@/app/api/tenant/custom-fields/route');

    const res = await POST(request('/api/tenant/custom-fields', CREATE_BODY));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('settings.manage');

    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const adminRes = await POST(request('/api/tenant/custom-fields', CREATE_BODY));
    expect(adminRes.status).toBe(201);
  });

  it('POST set-value stays member-open (record value, not schema)', async () => {
    const { POST } = await import('@/app/api/tenant/custom-fields/route');
    const res = await POST(request(
      '/api/tenant/custom-fields?action=set-value',
      { entityType: 'lead', entityId: 'lead-1', fieldKey: 'promo_source', value: 'instagram' },
    ));
    expect(res.status).toBe(200);
  });

  it('POST register-feature keeps its super-admin-only check for admins', async () => {
    const { POST } = await import('@/app/api/tenant/custom-fields/route');
    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const res = await POST(request('/api/tenant/custom-fields?action=register-feature', { featureName: 'x' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Super admin only');
  });

  it('PUT update-definition: 403 for member, past the gate for admin', async () => {
    const { PUT } = await import('@/app/api/tenant/custom-fields/route');

    const res = await PUT(request('/api/tenant/custom-fields', { fieldId: 'field-1', fieldLabel: 'Renamed' }, 'PUT'));
    expect(res.status).toBe(403);

    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const adminRes = await PUT(request('/api/tenant/custom-fields', { fieldId: 'field-1', fieldLabel: 'Renamed' }, 'PUT'));
    expect(adminRes.status).not.toBe(403);
  });

  it('DELETE definition: 403 for member, past the gate for admin', async () => {
    const { DELETE } = await import('@/app/api/tenant/custom-fields/route');

    const res = await DELETE(request('/api/tenant/custom-fields?fieldId=field-1', undefined, 'DELETE'));
    expect(res.status).toBe(403);

    mockRequireAuth.mockResolvedValueOnce(ADMIN);
    const adminRes = await DELETE(request('/api/tenant/custom-fields?fieldId=field-1', undefined, 'DELETE'));
    expect(adminRes.status).not.toBe(403);
  });

  it('GET definitions stays member-open', async () => {
    const { GET } = await import('@/app/api/tenant/custom-fields/route');
    const res = await GET(request('/api/tenant/custom-fields?entityType=leads', undefined, 'GET'));
    expect(res.status).toBe(200);
  });
});
