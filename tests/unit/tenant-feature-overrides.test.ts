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

// tenant_modules isolates on app.current_tenant with no super-admin escape, so the
// route reads and writes it inside the target tenant's context. Unit tests have no
// pool, so run that callback against a drizzle-shaped stub transaction instead.
const mockTx = vi.hoisted(() => ({
  select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ moduleId: 'ai-assistant' }]) })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn().mockResolvedValue([]),
      onConflictDoUpdate: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ moduleId: 'ai-assistant' }]) })),
    })),
  })),
}));
vi.mock('@/lib/db/rls', () => ({
  withTenantContext: (_tenantId: string, _userId: string, fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
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
    // The write must run through the tenant-scoped transaction, not the console
    // connection — on the console connection RLS matches zero rows silently.
    expect(mockTx.update).toHaveBeenCalled();
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
