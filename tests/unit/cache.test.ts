import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE: Record<string, string> = {};
let storageListeners: Array<() => void> = [];

function createMockStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    get length() { return Object.keys(store).length; },
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
    _store: store,
  };
}

let mockStorage: ReturnType<typeof createMockStorage>;

beforeEach(() => {
  mockStorage = createMockStorage();
  Object.keys(STORAGE).forEach(k => delete STORAGE[k]);
  storageListeners = [];

  Object.defineProperty(global, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cache', () => {
  let cache: typeof import('@/lib/cache');

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('@/lib/cache');
  });

  describe('getFromCache', () => {
    it('returns cached data for valid entry', () => {
      const entry = JSON.stringify({
        data: { name: 'test' },
        timestamp: Date.now(),
        ttl: 5 * 60 * 1000,
        userId: 'user-1',
      });
      mockStorage.getItem.mockReturnValue(entry);

      const result = cache.getFromCache('mykey', 'user-1');
      expect(result).toEqual({ name: 'test' });
    });

    it('returns null when no cache entry exists', () => {
      mockStorage.getItem.mockReturnValue(null);

      const result = cache.getFromCache('nonexistent', 'user-1');
      expect(result).toBeNull();
    });

    it('returns null and removes entry when expired', () => {
      const entry = JSON.stringify({
        data: 'old-data',
        timestamp: Date.now() - 10 * 60 * 1000,
        ttl: 5 * 60 * 1000,
        userId: 'user-1',
      });
      mockStorage.getItem.mockReturnValue(entry);

      const result = cache.getFromCache('mykey', 'user-1');
      expect(result).toBeNull();
      expect(mockStorage.removeItem).toHaveBeenCalled();
    });

    it('returns null when userId does not match (user isolation)', () => {
      const entry = JSON.stringify({
        data: 'secret',
        timestamp: Date.now(),
        ttl: 5 * 60 * 1000,
        userId: 'user-other',
      });
      mockStorage.getItem.mockReturnValue(entry);

      const result = cache.getFromCache('mykey', 'user-1');
      expect(result).toBeNull();
      expect(mockStorage.removeItem).toHaveBeenCalled();
    });

    it('returns null on JSON parse error', () => {
      mockStorage.getItem.mockReturnValue('invalid-json');

      const result = cache.getFromCache('mykey', 'user-1');
      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalled();
    });

    it('returns null when localStorage throws', () => {
      mockStorage.getItem.mockImplementation(() => { throw new Error('storage error'); });

      const result = cache.getFromCache('mykey', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('setInCache', () => {
    it('stores entry with default TTL', () => {
      cache.setInCache('mykey', { value: 42 }, 'user-1');

      expect(mockStorage.setItem).toHaveBeenCalled();
      const key = mockStorage.setItem.mock.calls[0][0];
      const stored = JSON.parse(mockStorage.setItem.mock.calls[0][1]);

      expect(key).toContain('nucrm_cache_');
      expect(stored.data).toEqual({ value: 42 });
      expect(stored.ttl).toBe(5 * 60 * 1000);
      expect(stored.userId).toBe('user-1');
    });

    it('stores entry with custom TTL', () => {
      cache.setInCache('mykey', 'data', 'user-1', { ttl: 1000 });

      const stored = JSON.parse(mockStorage.setItem.mock.calls[0][1]);
      expect(stored.ttl).toBe(1000);
    });

    it('logs storage on success', () => {
      cache.setInCache('mykey', 'data', 'user-1');

      expect(console.log).toHaveBeenCalledWith('[Cache] Stored: mykey');
    });

    it('handles QuotaExceededError by clearing expired entries', () => {
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
      mockStorage.setItem.mockImplementation(() => { throw quotaError; });

      cache.setInCache('mykey', 'data', 'user-1');

      expect(console.error).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith('[Cache] Storage quota exceeded, clearing old entries...');
    });

    it('handles generic set error without clearing', () => {
      mockStorage.setItem.mockImplementation(() => { throw new Error('unknown error'); });

      const clearExpiredSpy = vi.spyOn(cache, 'clearExpiredCache');

      cache.setInCache('mykey', 'data', 'user-1');

      expect(console.error).toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(clearExpiredSpy).not.toHaveBeenCalled();
    });
  });

  describe('getStaleData', () => {
    it('returns data even if expired (SWR strategy)', () => {
      const entry = JSON.stringify({
        data: 'stale-data',
        timestamp: Date.now() - 10 * 60 * 1000,
        ttl: 5 * 60 * 1000,
        userId: 'user-1',
      });
      mockStorage.getItem.mockReturnValue(entry);

      const result = cache.getStaleData('mykey', 'user-1');
      expect(result).toBe('stale-data');
    });

    it('returns null when no entry found', () => {
      mockStorage.getItem.mockReturnValue(null);

      const result = cache.getStaleData('mykey', 'user-1');
      expect(result).toBeNull();
    });

    it('returns null on error', () => {
      mockStorage.getItem.mockImplementation(() => { throw new Error('error'); });

      const result = cache.getStaleData('mykey', 'user-1');
      expect(result).toBeNull();
    });
  });

  describe('removeFromCache', () => {
    it('removes entry for given key and user', () => {
      cache.removeFromCache('mykey', 'user-1');

      const expectedPrefix = 'nucrm_cache_user-1_';
      expect(mockStorage.removeItem).toHaveBeenCalledWith(
        expect.stringContaining(expectedPrefix),
      );
      expect(console.log).toHaveBeenCalledWith('[Cache] Removed: mykey');
    });

    it('handles remove error gracefully', () => {
      mockStorage.removeItem.mockImplementation(() => { throw new Error('remove error'); });

      expect(() => cache.removeFromCache('mykey', 'user-1')).not.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('clearUserCache', () => {
    it('removes all entries for a specific user', () => {
      mockStorage.key.mockImplementation((i) => {
        const keys = [
          'nucrm_cache_user-1_key1',
          'nucrm_cache_user-1_key2',
          'nucrm_cache_user-2_key1',
          'other_prefix_key',
        ];
        return keys[i] ?? null;
      });
      Object.defineProperty(mockStorage, 'length', { get: () => 4 });

      cache.clearUserCache('user-1');

      expect(mockStorage.removeItem).toHaveBeenCalledWith('nucrm_cache_user-1_key1');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('nucrm_cache_user-1_key2');
      expect(mockStorage.removeItem).not.toHaveBeenCalledWith('nucrm_cache_user-2_key1');
      expect(mockStorage.removeItem).not.toHaveBeenCalledWith('other_prefix_key');
    });

    it('handles error gracefully', () => {
      mockStorage.key.mockImplementation(() => { throw new Error('error'); });
      Object.defineProperty(mockStorage, 'length', { get: () => 1 });

      expect(() => cache.clearUserCache('user-1')).not.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('clearExpiredCache', () => {
    it('removes only expired cache entries', () => {
      const freshEntry = JSON.stringify({
        data: 'fresh',
        timestamp: Date.now(),
        ttl: 5 * 60 * 1000,
        userId: 'user-1',
      });
      const staleEntry = JSON.stringify({
        data: 'stale',
        timestamp: Date.now() - 10 * 60 * 1000,
        ttl: 5 * 60 * 1000,
        userId: 'user-1',
      });

      const keys = ['nucrm_cache_fresh', 'nucrm_cache_stale', 'other_key'];
      mockStorage.key.mockImplementation((i) => keys[i] ?? null);
      Object.defineProperty(mockStorage, 'length', { get: () => 3 });
      mockStorage.getItem.mockImplementation((k) => {
        if (k === 'nucrm_cache_fresh') return freshEntry;
        if (k === 'nucrm_cache_stale') return staleEntry;
        return null;
      });

      cache.clearExpiredCache();

      expect(mockStorage.removeItem).toHaveBeenCalledWith('nucrm_cache_stale');
      expect(mockStorage.removeItem).not.toHaveBeenCalledWith('nucrm_cache_fresh');
      expect(mockStorage.removeItem).not.toHaveBeenCalledWith('other_key');
    });

    it('removes entries with invalid JSON', () => {
      mockStorage.key.mockImplementation((i) => {
        return i === 0 ? 'nucrm_cache_bad' : null;
      });
      Object.defineProperty(mockStorage, 'length', { get: () => 1 });
      mockStorage.getItem.mockReturnValue('not-valid-json');

      cache.clearExpiredCache();

      expect(mockStorage.removeItem).toHaveBeenCalledWith('nucrm_cache_bad');
    });

    it('handles error gracefully', () => {
      mockStorage.key.mockImplementation(() => { throw new Error('error'); });
      Object.defineProperty(mockStorage, 'length', { get: () => 1 });
      mockStorage.getItem.mockReturnValue('irrelevant');

      expect(() => cache.clearExpiredCache()).not.toThrow();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('clearAllCache', () => {
    it('removes all nucrm cache entries', () => {
      mockStorage.key.mockImplementation((i) => {
        const keys = [
          'nucrm_cache_key1',
          'nucrm_cache_key2',
          'other_app_data',
        ];
        return keys[i] ?? null;
      });
      Object.defineProperty(mockStorage, 'length', { get: () => 3 });

      cache.clearAllCache();

      expect(mockStorage.removeItem).toHaveBeenCalledWith('nucrm_cache_key1');
      expect(mockStorage.removeItem).toHaveBeenCalledWith('nucrm_cache_key2');
      expect(mockStorage.removeItem).not.toHaveBeenCalledWith('other_app_data');
      expect(console.log).toHaveBeenCalledWith('[Cache] Cleared all cache');
    });
  });

  describe('getCacheStats', () => {
    it('returns stats for all cache entries', () => {
      const freshEntry = JSON.stringify({
        data: 'x',
        timestamp: Date.now(),
        ttl: 5 * 60 * 1000,
        userId: 'u-1',
      });

      mockStorage.key.mockImplementation((i) => {
        return i === 0 ? 'nucrm_cache_mykey' : null;
      });
      Object.defineProperty(mockStorage, 'length', { get: () => 1 });
      mockStorage.getItem.mockReturnValue(freshEntry);

      const stats = cache.getCacheStats();

      expect(stats.total).toBe(1);
      expect(stats.size).toBeGreaterThan(0);
      expect(stats.entries[0]!.key).toBe('mykey');
      expect(stats.entries[0]!.age).toBe(0);
    });

    it('handles malformed entries with age -1', () => {
      mockStorage.key.mockImplementation((i) => {
        return i === 0 ? 'nucrm_cache_bad' : null;
      });
      Object.defineProperty(mockStorage, 'length', { get: () => 1 });
      mockStorage.getItem.mockReturnValue('invalid-json');

      const stats = cache.getCacheStats();

      expect(stats.total).toBe(1);
      expect(stats.entries[0]!.age).toBe(-1);
    });

    it('returns empty stats with zero entries', () => {
      Object.defineProperty(mockStorage, 'length', { get: () => 0 });
      mockStorage.key.mockReturnValue(null);

      const stats = cache.getCacheStats();

      expect(stats.total).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.entries).toHaveLength(0);
    });
  });
});
