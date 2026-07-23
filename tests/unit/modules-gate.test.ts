import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      modules: {
        findFirst: vi.fn(),
      },
      tenantModules: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock('@/drizzle/schema/modules', () => ({
  modules: {},
  tenantModules: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => args),
  and: vi.fn((...args) => args),
}));

describe('Module Gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('requireModule', () => {
    it('bypasses check for super admin', async () => {
      const { requireModule } = await import('@/lib/modules/gate');
      const result = await requireModule('tenant-1', 'module-1', true);
      expect(result).toBeNull();
    });

    it('returns 403 when module not found', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.modules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { requireModule } = await import('@/lib/modules/gate');
      const result = await requireModule('tenant-1', 'missing-module');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(403);
    });

    it('returns null when module is active', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.modules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1', isAvailable: true });
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'active', forceEnabled: false });

      const { requireModule } = await import('@/lib/modules/gate');
      const result = await requireModule('tenant-1', 'm1');
      expect(result).toBeNull();
    });

    it('returns null when force-enabled', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.modules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1', isAvailable: true });
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'inactive', forceEnabled: true });

      const { requireModule } = await import('@/lib/modules/gate');
      const result = await requireModule('tenant-1', 'm1');
      expect(result).toBeNull();
    });

    it('returns 403 when module not enabled for tenant', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.modules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1', isAvailable: true });
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { requireModule } = await import('@/lib/modules/gate');
      const result = await requireModule('tenant-1', 'm1');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(403);
    });

    it('returns 500 when error occurs', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.modules.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

      const { requireModule } = await import('@/lib/modules/gate');
      const result = await requireModule('tenant-1', 'm1');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(500);
    });
  });

  describe('requireFeature', () => {
    it('bypasses check when force-enabled', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'inactive', forceEnabled: true, enabledFeatures: null });

      const { requireFeature } = await import('@/lib/modules/gate');
      const result = await requireFeature('tenant-1', 'm1', 'feature-x');
      expect(result).toBeNull();
    });

    it('allows all features when no feature restrictions', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'active', forceEnabled: false, enabledFeatures: [] });

      const { requireFeature } = await import('@/lib/modules/gate');
      const result = await requireFeature('tenant-1', 'm1', 'feature-x');
      expect(result).toBeNull();
    });

    it('allows when feature is in enabled list', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'active', forceEnabled: false, enabledFeatures: ['feature-x', 'feature-y'] });

      const { requireFeature } = await import('@/lib/modules/gate');
      const result = await requireFeature('tenant-1', 'm1', 'feature-x');
      expect(result).toBeNull();
    });

    it('returns 403 when feature not in enabled list', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'active', forceEnabled: false, enabledFeatures: ['feature-x'] });

      const { requireFeature } = await import('@/lib/modules/gate');
      const result = await requireFeature('tenant-1', 'm1', 'feature-z');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(403);
    });

    it('returns 403 when module not installed', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { requireFeature } = await import('@/lib/modules/gate');
      const result = await requireFeature('tenant-1', 'm1', 'feature-x');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(403);
    });

    it('returns 500 when error occurs', async () => {
      const { db } = await import('@/drizzle/db');
      (db.query.tenantModules.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

      const { requireFeature } = await import('@/lib/modules/gate');
      const result = await requireFeature('tenant-1', 'm1', 'feature-x');
      expect(result).not.toBeNull();
      expect((result as unknown as { status: number }).status).toBe(500);
    });
  });
});
