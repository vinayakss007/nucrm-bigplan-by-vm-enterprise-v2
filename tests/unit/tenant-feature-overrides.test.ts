import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    query: {
      tenantModules: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      tenants: {
        findFirst: vi.fn().mockResolvedValue({ planId: 'starter' }),
    },
    },
  },
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    tenantId: 'test-tenant',
    userId: 'test-user',
    isAdmin: true,
    isSuperAdmin: true,
    user: { email: 'admin@test.com' },
  }),
}));

vi.mock('@/lib/audit/super-admin', () => ({
  logSuperAdminAction: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

describe('Tenant Feature Overrides API', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('should be importable', async () => {
    const route = await import('@/app/api/superadmin/tenants/[id]/modules/route');
    expect(route.GET).toBeDefined();
    expect(route.POST).toBeDefined();
  });

  it('GET should return modules with features', async () => {
    const { GET } = await import('@/app/api/superadmin/tenants/[id]/modules/route');
    const req = new Request('http://localhost:3000/api/superadmin/tenants/t1/modules');
    const res = await GET(req as unknown as Parameters<typeof GET>[0], {
      params: Promise.resolve({ id: 't1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('POST update_features should update enabled features', async () => {
    const mockUpdate = {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const { db } = await import('@/drizzle/db');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).update = vi.fn().mockReturnValue(mockUpdate);

    const { POST } = await import('@/app/api/superadmin/tenants/[id]/modules/route');
    const req = new Request('http://localhost:3000/api/superadmin/tenants/t1/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module_id: 'ai-assistant',
        action: 'update_features',
        features: ['AI email drafting', 'Lead scoring (0-100)'],
      }),
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0], {
      params: Promise.resolve({ id: 't1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('POST update_features should reject invalid features', async () => {
    const { POST } = await import('@/app/api/superadmin/tenants/[id]/modules/route');
    const req = new Request('http://localhost:3000/api/superadmin/tenants/t1/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module_id: 'ai-assistant',
        action: 'update_features',
        features: ['Nonexistent Feature'],
      }),
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0], {
      params: Promise.resolve({ id: 't1' }),
    });

    expect(res.status).toBe(400);
  });
});
