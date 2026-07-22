import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock drizzle DB ──────────────────────────────────────
const mockFindFirst = vi.fn();
const mockQuery = { modules: { findFirst: mockFindFirst }, tenantModules: { findFirst: mockFindFirst } };

vi.mock('@/drizzle/db', () => ({
  db: { query: mockQuery },
}));

vi.mock('@/drizzle/schema/modules', () => ({
  modules: { id: 'id', isAvailable: 'is_available' },
  tenantModules: { tenantId: 'tenant_id', moduleId: 'module_id', status: 'status', forceEnabled: 'force_enabled', enabledFeatures: 'enabled_features' },
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({ body, status: init?.status, _isNextResponse: true })),
  },
}));

describe('requireModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null immediately for super admin', async () => {
    const { requireModule } = await import('@/lib/modules/gate');
    const result = await requireModule('tenant-1', 'core-crm', true);
    expect(result).toBeNull();
  });

  it('returns 403 if module not found in registry', async () => {
    mockFindFirst.mockResolvedValueOnce(null); // modules.findFirst → null
    const { requireModule } = await import('@/lib/modules/gate');
    const result = await requireModule('tenant-1', 'nonexistent');
    expect(result).toBeDefined();
    expect(result!.status).toBe(403);
    expect(result!.body.error).toContain('not found');
  });

  it('returns 403 if module exists but not installed for tenant', async () => {
    // First call: module row found
    mockFindFirst
      .mockResolvedValueOnce({ id: 'core-crm', isAvailable: true })
      // Second call: no installation
      .mockResolvedValueOnce(null);
    const { requireModule } = await import('@/lib/modules/gate');
    const result = await requireModule('tenant-1', 'core-crm');
    expect(result).toBeDefined();
    expect(result!.status).toBe(403);
    expect(result!.body.error).toContain('not enabled');
  });

  it('returns 403 if module installation is disabled', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'core-crm', isAvailable: true })
      .mockResolvedValueOnce({ status: 'disabled', forceEnabled: false });
    const { requireModule } = await import('@/lib/modules/gate');
    const result = await requireModule('tenant-1', 'core-crm');
    expect(result).toBeDefined();
    expect(result!.status).toBe(403);
  });

  it('returns null if module is force-enabled by super admin', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'core-crm', isAvailable: true })
      .mockResolvedValueOnce({ status: 'disabled', forceEnabled: true });
    const { requireModule } = await import('@/lib/modules/gate');
    const result = await requireModule('tenant-1', 'core-crm');
    expect(result).toBeNull();
  });

  it('returns null if module is active for tenant', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'core-crm', isAvailable: true })
      .mockResolvedValueOnce({ status: 'active', forceEnabled: false });
    const { requireModule } = await import('@/lib/modules/gate');
    const result = await requireModule('tenant-1', 'core-crm');
    expect(result).toBeNull();
  });

  it('returns 500 on database error', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('DB connection failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { requireModule } = await import('@/lib/modules/gate');
    const result = await requireModule('tenant-1', 'core-crm');
    expect(result).toBeDefined();
    expect(result!.status).toBe(500);
    expect(result!.body.error).toContain('Failed to verify');
    consoleSpy.mockRestore();
  });
});

describe('requireFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 if module is not installed for tenant', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'visual_builder');
    expect(result).toBeDefined();
    expect(result!.status).toBe(403);
    expect(result!.body.error).toContain('not enabled');
  });

  it('returns null if module is force-enabled (bypasses feature check)', async () => {
    mockFindFirst.mockResolvedValueOnce({ status: 'disabled', forceEnabled: true, enabledFeatures: [] });
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'visual_builder');
    expect(result).toBeNull();
  });

  it('returns 403 if module installation is disabled', async () => {
    mockFindFirst.mockResolvedValueOnce({ status: 'disabled', forceEnabled: false, enabledFeatures: [] });
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'visual_builder');
    expect(result).toBeDefined();
    expect(result!.status).toBe(403);
  });

  it('returns null if no feature restrictions (empty array = all features allowed)', async () => {
    mockFindFirst.mockResolvedValueOnce({ status: 'active', forceEnabled: false, enabledFeatures: [] });
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'any_feature');
    expect(result).toBeNull();
  });

  it('returns null if feature is in the enabled list', async () => {
    mockFindFirst.mockResolvedValueOnce({
      status: 'active', forceEnabled: false,
      enabledFeatures: ['visual_builder', 'conditional_logic'],
    });
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'visual_builder');
    expect(result).toBeNull();
  });

  it('returns 403 if feature is not in the enabled list', async () => {
    mockFindFirst.mockResolvedValueOnce({
      status: 'active', forceEnabled: false,
      enabledFeatures: ['visual_builder'],
    });
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'bulk_campaigns');
    expect(result).toBeDefined();
    expect(result!.status).toBe(403);
    expect(result!.body.error).toContain('not enabled');
  });

  it('returns null if enabledFeatures is null (treated as empty)', async () => {
    mockFindFirst.mockResolvedValueOnce({ status: 'active', forceEnabled: false, enabledFeatures: null });
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'any_feature');
    expect(result).toBeNull();
  });

  it('returns 500 on database error', async () => {
    mockFindFirst.mockRejectedValueOnce(new Error('DB connection failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { requireFeature } = await import('@/lib/modules/gate');
    const result = await requireFeature('tenant-1', 'automation-pro', 'visual_builder');
    expect(result).toBeDefined();
    expect(result!.status).toBe(500);
    expect(result!.body.error).toContain('Failed to verify');
    consoleSpy.mockRestore();
  });
});
