import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = new Map<string, string>();

const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => { store.clear(); }),
  key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
  get length() { return store.size; },
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', mockLocalStorage);
  vi.stubGlobal('window', {});
  vi.stubGlobal('console', { warn: vi.fn(), log: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function getModule() {
  return await import('@/lib/client-cache');
}

describe('getFromCache / setInCache', () => {
  it('stores and retrieves data', async () => {
    const { setInCache, getFromCache } = await getModule();
    setInCache('test-key', { hello: 'world' });
    const result = getFromCache<{ hello: string }>('test-key');
    expect(result).toEqual({ hello: 'world' });
  });

  it('returns null for missing key', async () => {
    const { getFromCache } = await getModule();
    expect(getFromCache('nonexistent')).toBeNull();
  });

  it('returns null for expired entry', async () => {
    const { setInCache, getFromCache } = await getModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    setInCache('exp-key', 'value', { ttl: 100 });
    vi.advanceTimersByTime(200);
    expect(getFromCache('exp-key')).toBeNull();
  });

  it('uses custom ttl', async () => {
    const { setInCache, getFromCache } = await getModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    setInCache('custom-ttl', 'data', { ttl: 10000 });
    vi.advanceTimersByTime(5000);
    expect(getFromCache('custom-ttl')).toBe('data');
  });

  it('handles JSON parse errors gracefully', async () => {
    mockLocalStorage.getItem.mockReturnValueOnce('invalid json');
    const { getFromCache } = await getModule();
    expect(getFromCache('bad')).toBeNull();
  });

  it('handles storage quota exceeded with recovery', async () => {
    const { setInCache } = await getModule();
    mockLocalStorage.setItem
      .mockImplementationOnce(() => { const e = new DOMException('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; })
      .mockImplementationOnce(() => {});
    expect(() => setInCache('recover', 'val')).not.toThrow();
  });
});

describe('removeFromCache', () => {
  it('removes a cached entry', async () => {
    const { setInCache, removeFromCache, getFromCache } = await getModule();
    setInCache('rm-key', 'val');
    removeFromCache('rm-key');
    expect(getFromCache('rm-key')).toBeNull();
  });
});

describe('clearAll', () => {
  it('clears all cache entries', async () => {
    const { setInCache, clearAll, getFromCache } = await getModule();
    setInCache('a', 1);
    setInCache('b', 2);
    clearAll();
    expect(getFromCache('a')).toBeNull();
    expect(getFromCache('b')).toBeNull();
  });
});

describe('invalidateByPattern', () => {
  it('invalidates entries matching pattern', async () => {
    const { setInCache, invalidateByPattern, getFromCache } = await getModule();
    setInCache('user:1:profile', { name: 'Alice' });
    setInCache('user:2:profile', { name: 'Bob' });
    setInCache('tenant:1:settings', { theme: 'dark' });
    invalidateByPattern('user');
    expect(getFromCache('user:1:profile')).toBeNull();
    expect(getFromCache('user:2:profile')).toBeNull();
  });
});

describe('getCacheStats', () => {
  it('returns stats when cache has entries', async () => {
    const { setInCache, getCacheStats } = await getModule();
    setInCache('stat-key', 'x');
    const stats = getCacheStats();
    expect(stats.entries).toBeGreaterThanOrEqual(1);
    expect(stats.enabled).toBe(true);
    expect(typeof stats.size).toBe('number');
  });

  it('returns zero entries when empty', async () => {
    const { getCacheStats } = await getModule();
    const stats = getCacheStats();
    expect(stats.entries).toBe(0);
    expect(stats.size).toBe(0);
  });
});

describe('fetchWithCache', () => {
  it('returns cached data on hit', async () => {
    const { setInCache, fetchWithCache } = await getModule();
    setInCache('fc-key', 'cached-value');
    const fetcher = vi.fn().mockResolvedValue('fresh-value');
    const result = await fetchWithCache('fc-key', fetcher);
    expect(result).toBe('cached-value');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fetches and caches on miss', async () => {
    const { fetchWithCache, getFromCache } = await getModule();
    const fetcher = vi.fn().mockResolvedValue('fresh-value');
    const result = await fetchWithCache('miss-key', fetcher);
    expect(result).toBe('fresh-value');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(getFromCache('miss-key')).toBe('fresh-value');
  });

  it('skips cache when skipCache is true', async () => {
    const { setInCache, fetchWithCache } = await getModule();
    setInCache('skip-key', 'old');
    const fetcher = vi.fn().mockResolvedValue('new');
    const result = await fetchWithCache('skip-key', fetcher, { skipCache: true });
    expect(result).toBe('new');
  });

  it('refreshes when forceRefresh is true', async () => {
    const { setInCache, fetchWithCache } = await getModule();
    setInCache('force-key', 'old');
    const fetcher = vi.fn().mockResolvedValue('new');
    const result = await fetchWithCache('force-key', fetcher, { forceRefresh: true });
    expect(result).toBe('new');
  });
});

describe('CacheKeys', () => {
  it('generates user profile key', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.userProfile('u1')).toBe('user:u1:profile');
  });

  it('generates tenant info key', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.tenantInfo('t1')).toBe('tenant:t1:info');
  });

  it('generates contacts list key with filters', async () => {
    const { CacheKeys } = await getModule();
    const key = CacheKeys.contactsList('t1', { status: 'active' });
    expect(key).toContain('tenant:t1:contacts');
    expect(key).toContain('active');
  });

  it('generates contacts list key without filters', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.contactsList('t1')).toContain('{}');
  });

  it('generates deals list key with pipeline', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.dealsList('t1', 'pipe1')).toContain('pipe1');
  });

  it('generates deals list key without pipeline', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.dealsList('t1')).toContain('all');
  });

  it('generates platform stats key', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.platformStats()).toBe('superadmin:platform:stats');
  });

  it('generates tenant settings key', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.tenantSettings('t1')).toBe('tenant:t1:settings');
  });

  it('generates dashboard stats key', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.dashboardStats('t1')).toBe('tenant:t1:dashboard:stats');
  });

  it('generates org settings key', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.orgSettings('t1')).toBe('org:t1:settings');
  });

  it('generates notifications key', async () => {
    const { CacheKeys } = await getModule();
    expect(CacheKeys.notifications('u1')).toBe('user:u1:notifications');
  });
});
