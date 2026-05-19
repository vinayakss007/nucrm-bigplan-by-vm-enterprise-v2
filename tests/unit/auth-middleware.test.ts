import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue({ value: 'test-token' }),
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  verifyToken: vi.fn(),
  hashToken: vi.fn().mockResolvedValue('hashed-token'),
}));

vi.mock('@/lib/db/rls', () => ({
  setTenantContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/api-key', () => ({
  tryApiKeyAuth: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/tenant/request-context', () => ({
  requestContext: {
    generateId: vi.fn().mockReturnValue('req-123'),
    set: vi.fn(),
    getCached: vi.fn().mockResolvedValue(null),
    cache: vi.fn(),
    invalidate: vi.fn(),
  },
}));

describe('auth/middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOW_DEMO_MODE;
  });

  describe('can', () => {
    it('returns true for super admin', async () => {
      const { can } = await import('@/lib/auth/middleware');
      const ctx = { isSuperAdmin: true, isAdmin: false, permissions: {} } as any;
      expect(can(ctx, 'contacts.view')).toBe(true);
    });

    it('returns true for admin', async () => {
      const { can } = await import('@/lib/auth/middleware');
      const ctx = { isSuperAdmin: false, isAdmin: true, permissions: {} } as any;
      expect(can(ctx, 'contacts.edit')).toBe(true);
    });

    it('checks permissions for non-admin', async () => {
      const { can } = await import('@/lib/auth/middleware');
      const ctx = {
        isSuperAdmin: false,
        isAdmin: false,
        permissions: { 'contacts.view': true, 'contacts.edit': false },
      } as any;
      expect(can(ctx, 'contacts.view')).toBe(true);
      expect(can(ctx, 'contacts.edit')).toBe(false);
    });

    it('returns true when all permission is granted', async () => {
      const { can } = await import('@/lib/auth/middleware');
      const ctx = {
        isSuperAdmin: false,
        isAdmin: false,
        permissions: { all: true },
      } as any;
      expect(can(ctx, 'anything')).toBe(true);
    });
  });

  describe('requirePerm', () => {
    it('returns null when user has permission', async () => {
      const { requirePerm } = await import('@/lib/auth/middleware');
      const ctx = { isSuperAdmin: true, isAdmin: false, permissions: {} } as any;
      expect(requirePerm(ctx, 'contacts.view')).toBeNull();
    });

    it('returns 403 response when user lacks permission', async () => {
      const { requirePerm } = await import('@/lib/auth/middleware');
      const ctx = {
        isSuperAdmin: false,
        isAdmin: false,
        permissions: { 'contacts.view': false },
      } as any;
      const response = requirePerm(ctx, 'contacts.edit');
      expect(response).not.toBeNull();
    });
  });
});
