/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2999 — every plugin mutation/execution endpoint was open to any
 * authenticated tenant user. Registering or patching a plugin stores an
 * attacker-chosen baseUrl plus encrypted credentials that execute/test then
 * fire server-side requests with; delete disables a tenant integration. All
 * five now require admin, mirroring the webhooks (route.ts:76) and dunning
 * twins. These tests pin the 403 for non-admins and the pass-through for
 * admins on each handler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn(async (): unknown => ({
  tenantId: 'tenant-1',
  userId: 'user-1',
  isAdmin: false,
}));

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <T,>(h: T) => h,
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: (request: NextRequest) => mockRequireAuth(request),
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/api/concurrency', () => ({
  concurrencyGuard: vi.fn(async () => null),
}));

vi.mock('@/lib/plugins/engine', () => ({
  testPluginConnection: vi.fn(async () => ({ success: true })),
  executePluginAction: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/lib/plugins/crypto', () => ({
  encryptAuthConfig: vi.fn(() => 'enc'),
  decryptAuthConfig: vi.fn(() => ({ type: 'none' })),
  redactAuthConfig: vi.fn((c: unknown) => c),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
          orderBy: vi.fn(async () => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn(async () => []) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => []) })),
    })),
  },
}));

function jsonRequest(path: string, body: unknown, method = 'POST'): NextRequest {
  return new Request(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const idContext = { params: Promise.resolve({ id: 'plugin-1' }) };

describe('plugin routes require admin (#2999)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1', isAdmin: false });
  });

  it('POST /plugins: 403 for non-admin, validation beyond the gate for admin', async () => {
    const { POST } = await import('@/app/api/tenant/plugins/route');

    const res = await POST(jsonRequest('/api/tenant/plugins', { name: 'x', baseUrl: 'https://e.com' }));
    expect(res.status).toBe(403);

    mockRequireAuth.mockResolvedValueOnce({ tenantId: 'tenant-1', userId: 'user-1', isAdmin: true });
    const adminRes = await POST(jsonRequest('/api/tenant/plugins', {}));
    expect(adminRes.status).toBe(400); // past the gate, fails name/baseUrl validation
  });

  it('PATCH /plugins/[id]: 403 for non-admin', async () => {
    const { PATCH } = await import('@/app/api/tenant/plugins/[id]/route');
    const res = await PATCH(jsonRequest('/api/tenant/plugins/plugin-1', { status: 'active' }, 'PATCH'), idContext);
    expect(res.status).toBe(403);
  });

  it('DELETE /plugins/[id]: 403 for non-admin', async () => {
    const { DELETE } = await import('@/app/api/tenant/plugins/[id]/route');
    const res = await DELETE(jsonRequest('/api/tenant/plugins/plugin-1', undefined, 'DELETE'), idContext);
    expect(res.status).toBe(403);
  });

  it('POST /plugins/[id]/test: 403 for non-admin, plugin lookup beyond the gate for admin', async () => {
    const { POST } = await import('@/app/api/tenant/plugins/[id]/test/route');

    const res = await POST(jsonRequest('/api/tenant/plugins/plugin-1/test', {}), idContext);
    expect(res.status).toBe(403);

    mockRequireAuth.mockResolvedValueOnce({ tenantId: 'tenant-1', userId: 'user-1', isAdmin: true });
    const adminRes = await POST(jsonRequest('/api/tenant/plugins/plugin-1/test', {}), idContext);
    expect(adminRes.status).toBe(404); // past the gate; the stubbed select finds no plugin
  });

  it('POST /plugins/[id]/execute: 403 for non-admin, action validation beyond for admin', async () => {
    const { POST } = await import('@/app/api/tenant/plugins/[id]/execute/route');

    const res = await POST(jsonRequest('/api/tenant/plugins/plugin-1/execute', { action: 'do' }), idContext);
    expect(res.status).toBe(403);

    mockRequireAuth.mockResolvedValueOnce({ tenantId: 'tenant-1', userId: 'user-1', isAdmin: true });
    const adminRes = await POST(jsonRequest('/api/tenant/plugins/plugin-1/execute', {}), idContext);
    expect(adminRes.status).toBe(400); // past the gate; fails 'action is required'
  });
});
