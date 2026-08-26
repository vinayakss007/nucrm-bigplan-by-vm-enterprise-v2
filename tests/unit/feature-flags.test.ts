import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ioredis before importing the module
vi.mock('ioredis', () => {
  const store = new Map<string, string>();
  const MockRedis = vi.fn(function MockRedis() {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      disconnect: vi.fn(),
      get: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
      set: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve('OK'); }),
      keys: vi.fn((pattern: string) => {
        const prefix = pattern.replace('*', '');
        return Promise.resolve([...store.keys()].filter(k => k.startsWith(prefix)));
      }),
      mget: vi.fn((...keys: string[]) => Promise.resolve(keys.map(k => store.get(k) || null))),
      quit: vi.fn().mockResolvedValue(undefined),
    };
  });
  return { default: MockRedis, Redis: MockRedis, __store: store };
});

describe('Feature Flags', () => {
  beforeEach(() => {
    vi.resetModules();
    // The shared client is only created when REDIS_URL is configured
    // (matches production behavior); point it at the ioredis mock.
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isFeatureEnabled returns false for unknown flags', async () => {
    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    expect(await isFeatureEnabled('nonexistent-flag')).toBe(false);
  });

  it('isFeatureEnabled returns true for default enabled flags', async () => {
    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    expect(await isFeatureEnabled('realtime-notifications')).toBe(true);
  });

  it('isFeatureEnabled returns false for default disabled flags', async () => {
    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    expect(await isFeatureEnabled('bulk-email-campaigns')).toBe(false);
  });

  it('setFeatureFlag + isFeatureEnabled roundtrip', async () => {
    const { setFeatureFlag, isFeatureEnabled } = await import('@/lib/feature-flags');
    await setFeatureFlag({ key: 'test-flag', enabled: true });
    expect(await isFeatureEnabled('test-flag')).toBe(true);

    await setFeatureFlag({ key: 'test-flag', enabled: false });
    expect(await isFeatureEnabled('test-flag')).toBe(false);
  });

  it('tenant targeting enables flag only for specified tenants', async () => {
    const { setFeatureFlag, isFeatureEnabled } = await import('@/lib/feature-flags');
    await setFeatureFlag({
      key: 'targeted-flag',
      enabled: true,
      targetTenants: ['tenant-1', 'tenant-2'],
      rolloutPercentage: 0,
    });

    expect(await isFeatureEnabled('targeted-flag', { tenantId: 'tenant-1' })).toBe(true);
    expect(await isFeatureEnabled('targeted-flag', { tenantId: 'tenant-3' })).toBe(false);
  });

  it('percentage rollout is deterministic per user', async () => {
    const { setFeatureFlag, isFeatureEnabled } = await import('@/lib/feature-flags');
    await setFeatureFlag({ key: 'rollout-flag', enabled: true, rolloutPercentage: 50 });

    // Same user should always get same result
    const result1 = await isFeatureEnabled('rollout-flag', { userId: 'user-abc' });
    const result2 = await isFeatureEnabled('rollout-flag', { userId: 'user-abc' });
    expect(result1).toBe(result2);
  });

  it('getAllFlags returns both defaults and custom flags', async () => {
    const { setFeatureFlag, getAllFlags } = await import('@/lib/feature-flags');
    await setFeatureFlag({ key: 'custom-flag', enabled: true, description: 'Custom' });

    const flags = await getAllFlags();
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.find(f => f.key === 'realtime-notifications')).toBeTruthy();
    expect(flags.find(f => f.key === 'custom-flag')).toBeTruthy();
  });
});
