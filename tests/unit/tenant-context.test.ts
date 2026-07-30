import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock variables (available inside vi.mock factories) ──────────────
const {
  mockCookiesGet,
  mockCookies,
  mockRedirect,
  mockVerifyToken,
  mockDbSelectChain,
  mockDbSelect,
  mockDbQueryTenants,
  mockDbQueryUsers,
  mockDbQueryPlans,
} = vi.hoisted(() => {
  const mockCookiesGet = vi.fn();
  const mockCookies = vi.fn().mockResolvedValue({
    get: mockCookiesGet,
    set: vi.fn(),
    delete: vi.fn(),
  });
  const mockRedirect = vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
  const mockVerifyToken = vi.fn();
  const mockDbSelectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };
  const mockDbSelect = vi.fn().mockReturnValue(mockDbSelectChain);
  const mockDbQueryTenants = { findFirst: vi.fn() };
  const mockDbQueryUsers = { findFirst: vi.fn() };
  const mockDbQueryPlans = { findFirst: vi.fn() };

  return {
    mockCookiesGet,
    mockCookies,
    mockRedirect,
    mockVerifyToken,
    mockDbSelectChain,
    mockDbSelect,
    mockDbQueryTenants,
    mockDbQueryUsers,
    mockDbQueryPlans,
  };
});

// ─── vi.mock calls ───────────────────────────────────────────────────────────
vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(''),
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}));

vi.mock('@/lib/auth/session', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    query: {
      tenants: mockDbQueryTenants,
      users: mockDbQueryUsers,
      plans: mockDbQueryPlans,
    },
  },
}));

vi.mock('@/drizzle/schema', () => ({
  tenants: { id: 'tenants.id', slug: 'slug', name: 'name', planId: 'planId', status: 'status' },
  users: { id: 'users.id', email: 'email', isSuperAdmin: 'isSuperAdmin', lastTenantId: 'lastTenantId' },
  plans: { id: 'plans.id', name: 'name' },
  tenantMembers: {
    userId: 'tenantMembers.userId',
    tenantId: 'tenantMembers.tenantId',
    status: 'tenantMembers.status',
    roleSlug: 'roleSlug',
    roleId: 'roleId',
    createdAt: 'createdAt',
  },
  roles: { id: 'roles.id', permissions: 'permissions' },
  sessions: {},
}));

vi.mock('drizzle-orm', () => {
  // sql is used as both a tagged template literal and has property accessors
  const sqlFn = (...args: unknown[]) => args;
  return {
    eq: vi.fn((...args: unknown[]) => args),
    and: vi.fn((...args: unknown[]) => args),
    or: vi.fn((...args: unknown[]) => args),
    gt: vi.fn((...args: unknown[]) => args),
    desc: vi.fn((v: unknown) => v),
    sql: new Proxy(sqlFn, { get: () => vi.fn() }),
  };
});

vi.mock('@/lib/db/rls', () => ({
  setTenantContext: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────
import { requireTenantCtx, can, isAtLimit } from '@/lib/tenant/context';
import type { TenantContext } from '@/types';

// ─── Helper: build a mock TenantContext ──────────────────────────────────────
function makeTenantContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    userId: 'user-1',
    tenantId: 'tenant-1',
    roleSlug: 'member',
    permissions: {},
    isAdmin: false,
    isSuperAdmin: false,
    tenant: {
      id: 'tenant-1',
      status: 'active',
      trial_ends_at: null,
      name: 'Test Tenant',
      plan_id: 'pro',
      primary_color: '#7c3aed',
      settings: {} as TenantContext['tenant']['settings'],
      current_users: 3,
      current_contacts: 100,
    },
    plan: {
      id: 'pro',
      name: 'Pro',
      max_users: 10,
      max_contacts: 5000,
      max_deals: 500,
      max_automations: 20,
      features: ['automation', 'api'],
    },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests for pure utility functions: can() and isAtLimit()
// ═══════════════════════════════════════════════════════════════════════════════
describe('can()', () => {
  it('returns true for super admin regardless of permissions', () => {
    const ctx = makeTenantContext({ isSuperAdmin: true, permissions: {} });
    expect(can(ctx, 'contacts.view')).toBe(true);
    expect(can(ctx, 'anything.unknown')).toBe(true);
  });

  it('returns true for admin regardless of permissions', () => {
    const ctx = makeTenantContext({ isAdmin: true, permissions: {} });
    expect(can(ctx, 'deals.edit')).toBe(true);
  });

  it('returns true when "all" permission is set', () => {
    const ctx = makeTenantContext({ permissions: { all: true } });
    expect(can(ctx, 'contacts.delete')).toBe(true);
  });

  it('returns true when specific permission is granted', () => {
    const ctx = makeTenantContext({ permissions: { 'contacts.view': true } });
    expect(can(ctx, 'contacts.view')).toBe(true);
  });

  it('returns false when permission is not granted', () => {
    const ctx = makeTenantContext({ permissions: { 'contacts.view': true } });
    expect(can(ctx, 'contacts.delete')).toBe(false);
  });

  it('returns false when permission is explicitly false', () => {
    const ctx = makeTenantContext({ permissions: { 'deals.edit': false } });
    expect(can(ctx, 'deals.edit')).toBe(false);
  });
});

describe('isAtLimit()', () => {
  it('returns false for enterprise plan (no limits)', () => {
    const ctx = makeTenantContext({
      plan: { ...makeTenantContext().plan, id: 'enterprise' },
      tenant: { ...makeTenantContext().tenant, current_users: 999 },
    });
    expect(isAtLimit(ctx, 'users')).toBe(false);
  });

  it('returns true when current users equals max users', () => {
    const ctx = makeTenantContext({
      plan: { ...makeTenantContext().plan, max_users: 5 },
      tenant: { ...makeTenantContext().tenant, current_users: 5 },
    });
    expect(isAtLimit(ctx, 'users')).toBe(true);
  });

  it('returns true when current users exceeds max users', () => {
    const ctx = makeTenantContext({
      plan: { ...makeTenantContext().plan, max_users: 5 },
      tenant: { ...makeTenantContext().tenant, current_users: 6 },
    });
    expect(isAtLimit(ctx, 'users')).toBe(true);
  });

  it('returns false when current users is under limit', () => {
    const ctx = makeTenantContext({
      plan: { ...makeTenantContext().plan, max_users: 10 },
      tenant: { ...makeTenantContext().tenant, current_users: 3 },
    });
    expect(isAtLimit(ctx, 'users')).toBe(false);
  });

  it('returns true when contacts at limit', () => {
    const ctx = makeTenantContext({
      plan: { ...makeTenantContext().plan, max_contacts: 500 },
      tenant: { ...makeTenantContext().tenant, current_contacts: 500 },
    });
    expect(isAtLimit(ctx, 'contacts')).toBe(true);
  });

  it('returns false when contacts under limit', () => {
    const ctx = makeTenantContext({
      plan: { ...makeTenantContext().plan, max_contacts: 5000 },
      tenant: { ...makeTenantContext().tenant, current_contacts: 100 },
    });
    expect(isAtLimit(ctx, 'contacts')).toBe(false);
  });

  it('returns false when limit is 0 or negative (unlimited)', () => {
    const ctx = makeTenantContext({
      plan: { ...makeTenantContext().plan, max_users: 0 },
      tenant: { ...makeTenantContext().tenant, current_users: 10 },
    });
    expect(isAtLimit(ctx, 'users')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests for requireTenantCtx() with mocks
// ═══════════════════════════════════════════════════════════════════════════════
describe('requireTenantCtx()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire the chain mock defaults
    mockDbSelectChain.from.mockReturnThis();
    mockDbSelectChain.innerJoin.mockReturnThis();
    mockDbSelectChain.leftJoin.mockReturnThis();
    mockDbSelectChain.where.mockReturnThis();
    mockDbSelectChain.orderBy.mockReturnThis();
    mockDbSelectChain.limit.mockReturnThis();
    mockDbSelect.mockReturnValue(mockDbSelectChain);

    delete process.env['ALLOW_DEMO_MODE'];
    process.env['NODE_ENV'] = 'test';
  });

  it('redirects to /auth/login when no session cookie exists (production)', async () => {
    process.env['NODE_ENV'] = 'production';
    mockCookiesGet.mockReturnValue(undefined);

    await expect(requireTenantCtx()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/login');
  });

  it('redirects to /auth/login when no cookie and ALLOW_DEMO_MODE is not true', async () => {
    mockCookiesGet.mockReturnValue(undefined);
    process.env['ALLOW_DEMO_MODE'] = 'false';

    await expect(requireTenantCtx()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/login');
  });

  it('redirects to /auth/login when token is invalid', async () => {
    mockCookiesGet.mockReturnValue({ value: 'invalid-token' });
    mockVerifyToken.mockResolvedValue(null);

    await expect(requireTenantCtx()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
    expect(mockVerifyToken).toHaveBeenCalledWith('invalid-token');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/login');
  });

  it('redirects to /auth/no-workspace when user has no active tenant membership', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-token' });
    mockVerifyToken.mockResolvedValue({ userId: 'user-123' });
    mockDbSelectChain.then.mockImplementation((cb: (rows: unknown[]) => unknown) => cb([]));

    // User exists but is not a super admin
    mockDbQueryUsers.findFirst.mockResolvedValue({ isSuperAdmin: false });

    await expect(requireTenantCtx()).rejects.toThrow('NEXT_REDIRECT:/auth/no-workspace');
    expect(mockRedirect).toHaveBeenCalledWith('/auth/no-workspace');
  });

  it('redirects to /superadmin/dashboard when user has no membership but is super admin', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-token' });
    mockVerifyToken.mockResolvedValue({ userId: 'admin-123' });
    mockDbSelectChain.then.mockImplementation((cb: (rows: unknown[]) => unknown) => cb([]));

    mockDbQueryUsers.findFirst.mockResolvedValue({ isSuperAdmin: true });

    await expect(requireTenantCtx()).rejects.toThrow('NEXT_REDIRECT:/superadmin/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/superadmin/dashboard');
  });

  it('returns TenantContext when valid session and active membership exist', async () => {
    mockCookiesGet.mockReturnValue({ value: 'valid-token' });
    mockVerifyToken.mockResolvedValue({ userId: 'user-456' });

    const dbRow = {
      user_id: 'user-456',
      is_super_admin: false,
      tenant_id: 'tenant-789',
      role_slug: 'admin',
      permissions: { 'contacts.view': true },
      tenant_name: 'Acme Corp',
      plan_id: 'pro',
      primary_color: '#3b82f6',
      tenant_settings: { theme: 'dark' },
      tenant_status: 'active',
      trial_ends_at: null,
      current_users: 4,
      current_contacts: 200,
      plan_name: 'Professional',
      max_users: 25,
      max_contacts: 10000,
      max_deals: 1000,
      max_automations: 50,
      features: ['automation', 'api', 'integrations'],
    };

    mockDbSelectChain.then.mockImplementation((cb: (rows: unknown[]) => unknown) => cb([dbRow]));

    const result = await requireTenantCtx();

    expect(result.userId).toBe('user-456');
    expect(result.tenantId).toBe('tenant-789');
    expect(result.roleSlug).toBe('admin');
    expect(result.isAdmin).toBe(true);
    expect(result.isSuperAdmin).toBe(false);
    expect(result.tenant.name).toBe('Acme Corp');
    expect(result.tenant.status).toBe('active');
    expect(result.plan.name).toBe('Professional');
    expect(result.plan.max_users).toBe(25);
    expect(result.plan.features).toContain('automation');
  });

  it('returns context with correct permissions for non-admin user', async () => {
    mockCookiesGet.mockReturnValue({ value: 'member-token' });
    mockVerifyToken.mockResolvedValue({ userId: 'user-member' });

    const dbRow = {
      user_id: 'user-member',
      is_super_admin: false,
      tenant_id: 'tenant-abc',
      role_slug: 'member',
      permissions: { 'contacts.view': true, 'deals.view': true },
      tenant_name: 'Member Org',
      plan_id: 'free',
      primary_color: '#7c3aed',
      tenant_settings: {},
      tenant_status: 'active',
      trial_ends_at: null,
      current_users: 2,
      current_contacts: 50,
      plan_name: 'Free',
      max_users: 5,
      max_contacts: 500,
      max_deals: 100,
      max_automations: 3,
      features: [],
    };

    mockDbSelectChain.then.mockImplementation((cb: (rows: unknown[]) => unknown) => cb([dbRow]));

    const result = await requireTenantCtx();

    expect(result.isAdmin).toBe(false);
    expect(result.roleSlug).toBe('member');
    expect(result.permissions).toEqual({ 'contacts.view': true, 'deals.view': true });
  });
});
