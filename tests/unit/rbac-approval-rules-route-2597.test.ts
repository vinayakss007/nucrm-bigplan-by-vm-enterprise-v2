/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockRequireAuth = vi.fn();

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  };
});

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));

import { GET } from '@/app/api/tenant/rbac/approval-rules/route';

describe('GET /api/tenant/rbac/approval-rules (#2597)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const req = new NextRequest('http://localhost:3000/api/tenant/rbac/approval-rules');
    const res = (await GET(req, {} as never)) as NextResponse;

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('answers 403 when user is not an admin', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      isAdmin: false,
      isSuperAdmin: false,
      roleSlug: 'rep',
    });

    const req = new NextRequest('http://localhost:3000/api/tenant/rbac/approval-rules');
    const res = (await GET(req, {} as never)) as NextResponse;

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'Admin required' });
  });

  it('answers 200 with an empty list for tenant admin (honest empty state, not 404)', async () => {
    mockRequireAuth.mockResolvedValue({
      userId: 'admin-1',
      tenantId: 'tenant-1',
      isAdmin: true,
      isSuperAdmin: false,
      roleSlug: 'admin',
    });

    const req = new NextRequest('http://localhost:3000/api/tenant/rbac/approval-rules');
    const res = (await GET(req, {} as never)) as NextResponse;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [] });
  });
});
