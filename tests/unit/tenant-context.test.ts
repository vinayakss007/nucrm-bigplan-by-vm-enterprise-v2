import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Tenant Context - Pure Helpers', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('can', () => {
    it('returns true for super admin', async () => {
      const { can } = await import('@/lib/tenant/context');
      const ctx = { isSuperAdmin: true, isAdmin: false, permissions: {} } as Parameters<typeof can>[0];
      expect(can(ctx, 'some_permission')).toBe(true);
    });

    it('returns true for admin', async () => {
      const { can } = await import('@/lib/tenant/context');
      const ctx = { isSuperAdmin: false, isAdmin: true, permissions: {} } as Parameters<typeof can>[0];
      expect(can(ctx, 'some_permission')).toBe(true);
    });

    it('returns true when "all" permission is set', async () => {
      const { can } = await import('@/lib/tenant/context');
      const ctx = { isSuperAdmin: false, isAdmin: false, permissions: { all: true } } as Parameters<typeof can>[0];
      expect(can(ctx, 'some_permission')).toBe(true);
    });

    it('returns true when specific permission is set', async () => {
      const { can } = await import('@/lib/tenant/context');
      const ctx = { isSuperAdmin: false, isAdmin: false, permissions: { view_reports: true } } as Parameters<typeof can>[0];
      expect(can(ctx, 'view_reports')).toBe(true);
    });

    it('returns false when permission is not granted', async () => {
      const { can } = await import('@/lib/tenant/context');
      const ctx = { isSuperAdmin: false, isAdmin: false, permissions: {} } as Parameters<typeof can>[0];
      expect(can(ctx, 'view_reports')).toBe(false);
    });
  });

  describe('isAtLimit', () => {
    it('returns false for enterprise plan', async () => {
      const { isAtLimit } = await import('@/lib/tenant/context');
      const ctx = {
        plan: { id: 'enterprise', max_contacts: 500, max_users: 10 },
        tenant: { current_contacts: 9999, current_users: 9999 },
      } as Parameters<typeof isAtLimit>[0];
      expect(isAtLimit(ctx, 'contacts')).toBe(false);
      expect(isAtLimit(ctx, 'users')).toBe(false);
    });

    it('returns true when at contact limit', async () => {
      const { isAtLimit } = await import('@/lib/tenant/context');
      const ctx = {
        plan: { id: 'starter', max_contacts: 500, max_users: 5 },
        tenant: { current_contacts: 500, current_users: 2 },
      } as Parameters<typeof isAtLimit>[0];
      expect(isAtLimit(ctx, 'contacts')).toBe(true);
    });

    it('returns true when over contact limit', async () => {
      const { isAtLimit } = await import('@/lib/tenant/context');
      const ctx = {
        plan: { id: 'starter', max_contacts: 500, max_users: 5 },
        tenant: { current_contacts: 600, current_users: 2 },
      } as Parameters<typeof isAtLimit>[0];
      expect(isAtLimit(ctx, 'contacts')).toBe(true);
    });

    it('returns false when under limit', async () => {
      const { isAtLimit } = await import('@/lib/tenant/context');
      const ctx = {
        plan: { id: 'starter', max_contacts: 500, max_users: 5 },
        tenant: { current_contacts: 100, current_users: 2 },
      } as Parameters<typeof isAtLimit>[0];
      expect(isAtLimit(ctx, 'contacts')).toBe(false);
    });

    it('returns false when limit is not set (negative)', async () => {
      const { isAtLimit } = await import('@/lib/tenant/context');
      const ctx = {
        plan: { id: 'custom', max_contacts: -1, max_users: -1 },
        tenant: { current_contacts: 1000, current_users: 100 },
      } as Parameters<typeof isAtLimit>[0];
      expect(isAtLimit(ctx, 'contacts')).toBe(false);
    });

    it('returns true when at user limit', async () => {
      const { isAtLimit } = await import('@/lib/tenant/context');
      const ctx = {
        plan: { id: 'starter', max_contacts: 500, max_users: 5 },
        tenant: { current_contacts: 100, current_users: 5 },
      } as Parameters<typeof isAtLimit>[0];
      expect(isAtLimit(ctx, 'users')).toBe(true);
    });
  });
});
