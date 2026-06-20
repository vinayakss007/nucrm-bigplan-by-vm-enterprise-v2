import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbFindFirst = vi.fn();
const mockDbSelectResolve = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      tenants: {
        findFirst: vi.fn(() => mockDbFindFirst()),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockDbSelectResolve()),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema/core', () => ({
  tenants: { id: 'id', name: 'name', subdomain: 'subdomain', customDomain: 'custom_domain', settings: 'settings', planTier: 'plan_tier', isActive: 'is_active' },
  users: { id: 'id', tenantId: 'tenant_id', email: 'email' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...a) => ({ type: 'eq', args: a })),
  and: vi.fn((...a) => ({ type: 'and', args: a })),
  isNull: vi.fn((...a) => ({ type: 'isNull', args: a })),
}));

describe('Tenant Context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveTenant', () => {
    it('resolves tenant by subdomain', async () => {
      mockDbFindFirst.mockResolvedValueOnce({ id: 't-1', name: 'Acme', subdomain: 'acme' });
      const { resolveTenant } = await import('@/lib/tenant/context');
      const tenant = await resolveTenant('acme');
      expect(tenant).not.toBeNull();
      expect(tenant.id).toBe('t-1');
    });

    it('returns null for non-existent subdomain', async () => {
      mockDbFindFirst.mockResolvedValueOnce(undefined);
      const { resolveTenant } = await import('@/lib/tenant/context');
      const tenant = await resolveTenant('nonexistent');
      expect(tenant).toBeNull();
    });
  });

  describe('getTenantSettings', () => {
    it('returns parsed settings from tenant', async () => {
      mockDbFindFirst.mockResolvedValueOnce({
        settings: { ai_providers: [], allowedOrigins: ['https://app.example.com'] },
      });
      const { getTenantSettings } = await import('@/lib/tenant/context');
      const settings = await getTenantSettings('t-1');
      expect(settings.allowedOrigins).toContain('https://app.example.com');
    });

    it('returns defaults when tenant not found', async () => {
      mockDbFindFirst.mockResolvedValueOnce(undefined);
      const { getTenantSettings } = await import('@/lib/tenant/context');
      const settings = await getTenantSettings('nonexistent');
      expect(settings).toEqual({});
    });
  });
});
