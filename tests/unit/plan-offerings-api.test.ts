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
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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

describe('Plan Offerings API', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDb: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { db } = await import('@/drizzle/db');
    mockDb = db;
  });

  it('should be importable', async () => {
    const route = await import('@/app/api/superadmin/plans/[id]/offerings/route');
    expect(route.GET).toBeDefined();
    expect(route.PUT).toBeDefined();
  });

  it('GET should return offerings for a plan', async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockResolvedValue([
        { id: 'core-crm', manifest: { pricing: { free: { enabled: true } } } },
      ]),
    });

    const { GET } = await import('@/app/api/superadmin/plans/[id]/offerings/route');
    const req = new Request('http://localhost:3000/api/superadmin/plans/free/offerings');
    const res = await GET(req as unknown as Parameters<typeof GET>[0], {
      params: Promise.resolve({ id: 'free' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.plan_id).toBe('free');
    expect(Array.isArray(body.offerings)).toBe(true);
  });

  it('PUT should update offerings for a plan', async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'ai-assistant', manifest: {} }]),
        }),
      }),
    });
    mockDb.update.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const { PUT } = await import('@/app/api/superadmin/plans/[id]/offerings/route');
    const req = new Request('http://localhost:3000/api/superadmin/plans/pro/offerings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offerings: [{ module_id: 'ai-assistant', enabled: true, price: 25 }],
      }),
    });
    const res = await PUT(req as unknown as Parameters<typeof PUT>[0], {
      params: Promise.resolve({ id: 'pro' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('PUT should reject non-array offerings', async () => {
    const { PUT } = await import('@/app/api/superadmin/plans/[id]/offerings/route');
    const req = new Request('http://localhost:3000/api/superadmin/plans/pro/offerings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerings: 'not-an-array' }),
    });
    const res = await PUT(req as unknown as Parameters<typeof PUT>[0], {
      params: Promise.resolve({ id: 'pro' }),
    });

    expect(res.status).toBe(400);
  });
});
