import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    tenantId: 'test-tenant',
    userId: 'test-user',
    isAdmin: true,
    isSuperAdmin: false,
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

describe('Tenant Audit Log API', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDb: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { db } = await import('@/drizzle/db');
    mockDb = db;
  });

  it('should be importable', async () => {
    const route = await import('@/app/api/tenant/audit/route');
    expect(route.GET).toBeDefined();
    expect(typeof route.GET).toBe('function');
  });

  it('should return logs with field_changes array', async () => {
    const mockCount = [{ count: 2 }];
    const mockLogs = [
      {
        id: 'log-1',
        action: 'update',
        resource_type: 'contact',
        resource_id: 'contact-1',
        created_at: new Date().toISOString(),
        ip_address: '127.0.0.1',
        old_data: { name: 'Old Name' },
        new_data: { name: 'New Name' },
        full_name: 'Test User',
        email: 'test@example.com',
        user_id: 'user-1',
      },
      {
        id: 'log-2',
        action: 'create',
        resource_type: 'deal',
        resource_id: 'deal-1',
        created_at: new Date().toISOString(),
        ip_address: null,
        old_data: null,
        new_data: { title: 'New Deal' },
        full_name: 'Another User',
        email: 'another@example.com',
        user_id: 'user-2',
      },
    ];

    const mockFieldChanges = [
      {
        id: 'fc-1',
        entity_type: 'contact',
        entity_id: 'contact-1',
        field_name: 'name',
        field_label: 'Name',
        old_value: 'Old Name',
        new_value: 'New Name',
        change_type: 'update',
        user_name: 'Test User',
        user_email: 'test@example.com',
        created_at: new Date(),
      },
    ];

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(mockCount),
      }),
    });

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue(mockLogs),
              }),
            }),
          }),
        }),
      }),
    });

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockFieldChanges),
          }),
        }),
      }),
    });

    const { GET } = await import('@/app/api/tenant/audit/route');
    const req = new Request('http://localhost:3000/api/tenant/audit?limit=50&offset=0');
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.logs).toBeDefined();
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.total).toBeDefined();
  });

  it('should return 500 on error', async () => {
    mockDb.select.mockImplementation(() => {
      throw new Error('DB error');
    });

    const { GET } = await import('@/app/api/tenant/audit/route');
    const req = new Request('http://localhost:3000/api/tenant/audit');
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);

    expect(res.status).toBe(500);
  });
});
