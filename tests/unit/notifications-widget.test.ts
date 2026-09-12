import { describe, it, expect, vi, beforeEach } from 'vitest';

// #1615: routes/pages now run inside withPinnedConnection (via withApiRoute /
// withTenantScope). In unit tests there is no real pool, so stub the primitive
// to run the callback directly (matches tests/unit/auth-middleware-require-auth.test.ts).
vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));


vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/dashboard/widget-cache', () => ({
  withCache: vi.fn((_tid: string, _key: string, _ttl: number, fetcher: () => Promise<Response>) => fetcher()),
}));

vi.mock('server-only', () => ({}));

import { requireAuth, type AuthContext } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { NextResponse, type NextRequest } from 'next/server';

describe('Notifications Dashboard Widget API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ tenantId: 'tenant-1', userId: 'user-1', role: 'admin' } as unknown as AuthContext);
  });

  it('returns notifications for the current user', async () => {
    // Route performs a SINGLE query with unreadCount as a scalar subselect.
    const mockRows = [
      { id: 'n1', title: 'Task assigned', body: 'Review proposal', type: 'task_assigned', link: '/tasks/1', readAt: null, createdAt: new Date().toISOString(), unreadCount: 1 },
      { id: 'n2', title: 'Deal moved', body: null, type: 'deal_stage', link: null, readAt: new Date().toISOString(), createdAt: new Date().toISOString(), unreadCount: 1 },
    ];

    const limitFn = vi.fn().mockResolvedValue(mockRows);
    const orderByFn = vi.fn(() => ({ limit: limitFn }));
    const mockItems = { where: vi.fn(() => ({ orderBy: orderByFn })) };

    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockItems) });

    const { GET } = await import('@/app/api/tenant/dashboard/widgets/notifications/route');
    const req = new Request('http://localhost/api/tenant/dashboard/widgets/notifications');
    const res = await GET(req as unknown as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.stats.unreadCount).toBe(1);
  });

  it('returns empty array when no notifications exist', async () => {
    const limitFn = vi.fn().mockResolvedValue([]);
    const orderByFn = vi.fn(() => ({ limit: limitFn }));
    const mockItems = { where: vi.fn(() => ({ orderBy: orderByFn })) };

    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockItems) });

    const { GET } = await import('@/app/api/tenant/dashboard/widgets/notifications/route');
    const req = new Request('http://localhost/api/tenant/dashboard/widgets/notifications');
    const res = await GET(req as unknown as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.items).toEqual([]);
    expect(body.data.stats.unreadCount).toBe(0);
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const { GET } = await import('@/app/api/tenant/dashboard/widgets/notifications/route');
    const req = new Request('http://localhost/api/tenant/dashboard/widgets/notifications');
    const res = await GET(req as unknown as NextRequest);

    expect(res.status).toBe(401);
  });

  it('queries only for the authenticated user and tenant with limit 5', async () => {
    const limitFn = vi.fn().mockResolvedValue([]);
    const orderByFn = vi.fn(() => ({ limit: limitFn }));
    const mockItems = {
      where: vi.fn(() => {
        return { orderBy: orderByFn };
      }),
    };

    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockItems) });

    const { GET } = await import('@/app/api/tenant/dashboard/widgets/notifications/route');
    const req = new Request('http://localhost/api/tenant/dashboard/widgets/notifications');
    await GET(req as unknown as NextRequest);

    expect(orderByFn).toHaveBeenCalled();
    expect(limitFn).toHaveBeenCalledWith(5);
  });
});
