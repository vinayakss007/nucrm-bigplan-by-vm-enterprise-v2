/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCookies, mockRedirect, mockHeaders, mockVerifyToken, mockFindFirstUsers, mockDbSelect, mockSetTenantContext } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  mockHeaders: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockFindFirstUsers: vi.fn(),
  mockDbSelect: vi.fn(),
  mockSetTenantContext: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
  headers: () => mockHeaders(),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));
vi.mock('@/lib/auth/session', () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tenants: { findFirst: vi.fn() },
      users: { findFirst: (...args: any[]) => mockFindFirstUsers(...args) },
      plans: { findFirst: vi.fn() },
    },
    select: mockDbSelect,
  },
}));
vi.mock('@/lib/db/rls', () => ({
  setTenantContext: (...args: any[]) => mockSetTenantContext(...args),
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: any, _val: any) => `eq(${String(_val)})`),
  and: vi.fn((..._args: any[]) => 'and()'),
  or: vi.fn((..._args: any[]) => 'or()'),
  sql: Object.assign(vi.fn((_strings: any, ..._vals: any[]) => 'sql()'), { raw: vi.fn() }),
  desc: vi.fn((_v: any) => 'desc()'),
}));
vi.mock('@/drizzle/schema', () => ({
  tenants: { id: 'id', slug: 'slug', name: 'name', planId: 'plan_id', status: 'status', primaryColor: 'primary_color', settings: 'settings', trialEndsAt: 'trial_ends_at', currentUsers: 'current_users', currentContacts: 'current_contacts' },
  users: { id: 'id', email: 'email', isSuperAdmin: 'is_super_admin', lastTenantId: 'last_tenant_id' },
  plans: { id: 'id', name: 'name', maxUsers: 'max_users', maxContacts: 'max_contacts', maxDeals: 'max_deals', maxAutomations: 'max_automations', features: 'features' },
  tenantMembers: { userId: 'user_id', tenantId: 'tenant_id', roleSlug: 'role_slug', roleId: 'role_id', status: 'status', createdAt: 'created_at' },
  roles: { id: 'id', permissions: 'permissions' },
}));

import { requireTenantCtx, can, isAtLimit } from '@/lib/tenant/context';

const makeRow = (overrides: Record<string, any> = {}) => ({
  user_id: 'u1',
  is_super_admin: false,
  tenant_id: 't1',
  role_slug: 'admin',
  permissions: { contacts: true },
  tenant_name: 'Test Tenant',
  plan_id: 'pro',
  primary_color: '#7c3aed',
  tenant_settings: {},
  tenant_status: 'active',
  trial_ends_at: null,
  current_users: 5,
  current_contacts: 100,
  plan_name: 'Pro',
  max_users: 50,
  max_contacts: 10000,
  max_deals: 1000,
  max_automations: 50,
  features: ['contacts', 'deals'],
  ...overrides,
});

function mockJoinChain(rows: any[]) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          leftJoin: vi.fn(() => ({
            leftJoin: vi.fn(() => ({
              where: vi.fn(() => ({
                orderBy: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue(rows),
                })),
              })),
            })),
          })),
        })),
      })),
    })),
  };
}

describe('tenant/context', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('requireTenantCtx', () => {
    it('redirects to login when no session token', async () => {
      mockCookies.mockResolvedValue({ get: vi.fn(() => undefined) });
      process.env.NODE_ENV = 'production';
      await expect(requireTenantCtx()).rejects.toThrow('REDIRECT:/auth/login');
      delete process.env.NODE_ENV;
    });

    it('redirects to login when verifyToken returns null', async () => {
      mockCookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'tok' })) });
      mockVerifyToken.mockResolvedValue(null);
      await expect(requireTenantCtx()).rejects.toThrow('REDIRECT:/auth/login');
    });

    it('returns full TenantContext on valid token', async () => {
      mockCookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'tok' })) });
      mockVerifyToken.mockResolvedValue({ userId: 'u1' });
      mockDbSelect.mockReturnValue(mockJoinChain([makeRow()]));
      const ctx = await requireTenantCtx();
      expect(ctx.userId).toBe('u1');
      expect(ctx.tenantId).toBe('t1');
      expect(ctx.roleSlug).toBe('admin');
      expect(ctx.isAdmin).toBe(true);
      expect(ctx.isSuperAdmin).toBe(false);
      expect(ctx.tenant.name).toBe('Test Tenant');
      expect(ctx.plan.id).toBe('pro');
      expect(mockSetTenantContext).toHaveBeenCalled();
    });

    it('sets isSuperAdmin to true when user is super admin', async () => {
      mockCookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'tok' })) });
      mockVerifyToken.mockResolvedValue({ userId: 'u1' });
      mockDbSelect.mockReturnValue(mockJoinChain([makeRow({ is_super_admin: true })]));
      const ctx = await requireTenantCtx();
      expect(ctx.isSuperAdmin).toBe(true);
      expect(ctx.isAdmin).toBe(true);
    });

    it('redirects super admin with no tenant to /superadmin/dashboard', async () => {
      mockCookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'tok' })) });
      mockVerifyToken.mockResolvedValue({ userId: 'u1' });
      mockDbSelect.mockReturnValue(mockJoinChain([]));
      mockFindFirstUsers.mockResolvedValue({ isSuperAdmin: true });
      await expect(requireTenantCtx()).rejects.toThrow('REDIRECT:/superadmin/dashboard');
    });

    it('redirects non-admin with no tenant to /auth/no-workspace', async () => {
      mockCookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'tok' })) });
      mockVerifyToken.mockResolvedValue({ userId: 'u1' });
      mockDbSelect.mockReturnValue(mockJoinChain([]));
      mockFindFirstUsers.mockResolvedValue({ isSuperAdmin: false });
      await expect(requireTenantCtx()).rejects.toThrow('REDIRECT:/auth/no-workspace');
    });

    it('redirects expired trial to /tenant/trial-expired', async () => {
      mockCookies.mockResolvedValue({ get: vi.fn(() => ({ value: 'tok' })) });
      mockVerifyToken.mockResolvedValue({ userId: 'u1' });
      const pastDate = new Date('2020-01-01').toISOString();
      mockDbSelect.mockReturnValue(mockJoinChain([makeRow({
        tenant_status: 'trialing',
        trial_ends_at: pastDate,
      })]));
      mockHeaders.mockResolvedValue({ get: vi.fn(() => null) });
      await expect(requireTenantCtx()).rejects.toThrow('REDIRECT:/tenant/trial-expired');
    });
  });

  describe('can', () => {
    it('returns true for super admin', () => {
      expect(can({ isSuperAdmin: true, isAdmin: false } as any, 'anything')).toBe(true);
    });

    it('returns true for admin', () => {
      expect(can({ isSuperAdmin: false, isAdmin: true } as any, 'anything')).toBe(true);
    });

    it('returns true for "all" permission', () => {
      expect(can({ isSuperAdmin: false, isAdmin: false, permissions: { all: true } } as any, 'x')).toBe(true);
    });

    it('returns true when specific permission granted', () => {
      expect(can({ isSuperAdmin: false, isAdmin: false, permissions: { contacts: true } } as any, 'contacts')).toBe(true);
    });

    it('returns false when permission not granted', () => {
      expect(can({ isSuperAdmin: false, isAdmin: false, permissions: {} } as any, 'contacts')).toBe(false);
    });
  });

  describe('isAtLimit', () => {
    const baseCtx = {
      isSuperAdmin: false,
      isAdmin: false,
      permissions: {},
      tenant: { current_contacts: 100, current_users: 5 },
      plan: { id: 'pro', max_contacts: 200, max_users: 10 },
    } as any;

    it('returns false for enterprise plan', () => {
      expect(isAtLimit({ ...baseCtx, plan: { ...baseCtx.plan, id: 'enterprise' } }, 'contacts')).toBe(false);
    });

    it('returns true when at limit', () => {
      expect(isAtLimit({ ...baseCtx, tenant: { ...baseCtx.tenant, current_contacts: 200 } }, 'contacts')).toBe(true);
    });

    it('returns false when under limit', () => {
      expect(isAtLimit(baseCtx, 'contacts')).toBe(false);
    });

    it('returns false for users when under limit', () => {
      expect(isAtLimit(baseCtx, 'users')).toBe(false);
    });

    it('returns true for users when at limit', () => {
      expect(isAtLimit({ ...baseCtx, tenant: { ...baseCtx.tenant, current_users: 10 } }, 'users')).toBe(true);
    });
  });
});
