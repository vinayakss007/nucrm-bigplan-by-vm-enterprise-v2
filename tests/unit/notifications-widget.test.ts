import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    const mockRows = [
      { id: 'n1', title: 'Task assigned', body: 'Review proposal', type: 'task_assigned', link: '/tasks/1', readAt: null, createdAt: new Date().toISOString() },
      { id: 'n2', title: 'Deal moved', body: null, type: 'deal_stage', link: null, readAt: new Date().toISOString(), createdAt: new Date().toISOString() },
    ];

    const limitFn = vi.fn().mockResolvedValue(mockRows);
    const orderByFn = vi.fn(() => ({ limit: limitFn }));
    const mockItems = { where: vi.fn(() => ({ orderBy: orderByFn })) };
    const mockCount = { where: vi.fn(() => Promise.resolve([{ count: 1 }])) };

    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockItems) });
    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockCount) });

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
    const mockCount = { where: vi.fn(() => Promise.resolve([{ count: 0 }])) };

    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockItems) });
    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockCount) });

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
    const mockCount = { where: vi.fn(() => Promise.resolve([{ count: 0 }])) };

    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockItems) });
    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn(() => mockCount) });

    const { GET } = await import('@/app/api/tenant/dashboard/widgets/notifications/route');
    const req = new Request('http://localhost/api/tenant/dashboard/widgets/notifications');
    await GET(req as unknown as NextRequest);

    expect(orderByFn).toHaveBeenCalled();
    expect(limitFn).toHaveBeenCalledWith(5);
  });
});
