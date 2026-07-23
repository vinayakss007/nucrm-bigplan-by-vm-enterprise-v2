import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
};

vi.mock('@/lib/cache/index', () => ({
  cache: mockCache,
}));

describe('flags', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('isEnabled returns false for unknown flag', async () => {
    const { isEnabled } = await import('@/lib/flags/index');
    const result = await isEnabled('unknown-flag');
    expect(result).toBe(false);
  });

  it('isEnabled returns default value when no overrides', async () => {
    mockCache.get.mockResolvedValue(null);
    const { isEnabled } = await import('@/lib/flags/index');
    expect(await isEnabled('dashboard-v2')).toBe(true);
    expect(await isEnabled('ai-draft-emails')).toBe(false);
  });

  it('isEnabled returns false when override has enabled:false', async () => {
    mockCache.get.mockResolvedValue({ 'dashboard-v2': { enabled: false } });
    const { isEnabled } = await import('@/lib/flags/index');
    const result = await isEnabled('dashboard-v2');
    expect(result).toBe(false);
  });

  it('isEnabled returns true when tenantId is in override list', async () => {
    mockCache.get.mockResolvedValue({ 'ai-draft-emails': { enabled: true, tenantIds: ['tenant-1'] } });
    const { isEnabled } = await import('@/lib/flags/index');
    const result = await isEnabled('ai-draft-emails', { tenantId: 'tenant-1' });
    expect(result).toBe(true);
  });

  it('isEnabled respects userId overrides', async () => {
    mockCache.get.mockResolvedValue({ 'maintenance-mode': { enabled: true, userIds: ['user-1'] } });
    const { isEnabled } = await import('@/lib/flags/index');
    const result = await isEnabled('maintenance-mode', { userId: 'user-1' });
    expect(result).toBe(true);
  });

  it('isEnabled uses percentage rollout for users', async () => {
    mockCache.get.mockResolvedValue({ 'new-signup-flow': { enabled: true, percentage: 50 } });
    const { isEnabled } = await import('@/lib/flags/index');
    const result = await isEnabled('new-signup-flow', { userId: 'some-user-id' });
    expect(typeof result).toBe('boolean');
  });

  it('isEnabled falls back to default when override exists but context does not match', async () => {
    mockCache.get.mockResolvedValue({ 'ai-draft-emails': { enabled: true, tenantIds: ['other-tenant'] } });
    const { isEnabled } = await import('@/lib/flags/index');
    const result = await isEnabled('ai-draft-emails', { tenantId: 'tenant-1' });
    expect(result).toBe(false);
  });

  it('isEnabled accepts inline overrides', async () => {
    const { isEnabled } = await import('@/lib/flags/index');
    const overrides = { 'dashboard-v2': { enabled: false } };
    const result = await isEnabled('dashboard-v2', undefined, overrides);
    expect(result).toBe(false);
  });

  it('setOverride stores override in cache', async () => {
    mockCache.get.mockResolvedValue({});
    const { setOverride } = await import('@/lib/flags/index');
    await setOverride('dashboard-v2', { enabled: false });
    expect(mockCache.set).toHaveBeenCalledWith('flags:overrides', { 'dashboard-v2': { enabled: false } }, 300);
  });

  it('setOverride merges with existing overrides', async () => {
    mockCache.get.mockResolvedValue({ 'existing-flag': { enabled: true } });
    const { setOverride } = await import('@/lib/flags/index');
    await setOverride('new-flag', { enabled: false });
    expect(mockCache.set).toHaveBeenCalledWith(
      'flags:overrides',
      { 'existing-flag': { enabled: true }, 'new-flag': { enabled: false } },
      300
    );
  });

  it('deleteOverride removes override from cache', async () => {
    mockCache.get.mockResolvedValue({ 'dashboard-v2': { enabled: false }, 'other': { enabled: true } });
    const { deleteOverride } = await import('@/lib/flags/index');
    await deleteOverride('dashboard-v2');
    expect(mockCache.set).toHaveBeenCalledWith('flags:overrides', { 'other': { enabled: true } }, 300);
  });

  it('getAllFlags returns all flags with enabled status', async () => {
    mockCache.get.mockResolvedValue(null);
    const { getAllFlags } = await import('@/lib/flags/index');
    const flags = await getAllFlags();
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]).toHaveProperty('key');
    expect(flags[0]).toHaveProperty('enabled');
    expect(flags[0]).toHaveProperty('default');
  });

  it('DEFINED_FLAGS contains expected flags', async () => {
    const { DEFINED_FLAGS } = await import('@/lib/flags/index');
    const keys = DEFINED_FLAGS.map(f => f.key);
    expect(keys).toContain('dashboard-v2');
    expect(keys).toContain('maintenance-mode');
    expect(keys).toContain('sso-saml');
  });

  it('getFlagOverrides handles cache errors gracefully', async () => {
    mockCache.get.mockRejectedValue(new Error('Cache down'));
    const { isEnabled } = await import('@/lib/flags/index');
    const result = await isEnabled('dashboard-v2');
    expect(result).toBe(true);
  });
});
