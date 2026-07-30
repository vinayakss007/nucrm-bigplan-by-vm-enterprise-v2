/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock redis cache
const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDel = vi.fn();

vi.mock('@/lib/cache/index', () => ({
  cache: {
    get: (...args: any[]) => mockCacheGet(...args),
    set: (...args: any[]) => mockCacheSet(...args),
    del: (...args: any[]) => mockCacheDel(...args),
  },
}));

import {
  getContext,
  setContext,
  withRequestContext,
  withRequestId,
  getCurrentRequestId,
  generateRequestId,
  getOrFetchContext,
  getCachedContext,
  cacheContext,
  invalidateContext,
  batchGetContexts,
  requestContext,
} from '@/lib/tenant/request-context';

const sampleCtx = {
  userId: 'u1',
  tenantId: 't1',
  roleSlug: 'admin',
  permissions: { contacts: true },
  isAdmin: true,
  isSuperAdmin: false,
  cachedAt: Date.now(),
};

describe('request-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('withRequestContext + getContext/setContext', () => {
    it('stores and retrieves context within AsyncLocalStorage scope', () => {
      withRequestContext('req-1', () => {
        setContext('req-1', { ...sampleCtx, userId: 'u-in-scope' });
        const ctx = getContext('req-1');
        expect(ctx).toBeDefined();
        expect(ctx!.userId).toBe('u-in-scope');
      });
    });

    it('returns undefined for context outside scope', () => {
      const ctx = getContext('req-outside');
      expect(ctx).toBeUndefined();
    });

    it('returns undefined for different requestId within same scope', () => {
      withRequestContext('req-1', () => {
        setContext('req-1', { ...sampleCtx });
        const ctx = getContext('req-other');
        expect(ctx).toBeUndefined();
      });
    });

    it('handles multiple requests in different scopes', () => {
      withRequestContext('req-a', () => {
        setContext('req-a', { ...sampleCtx, userId: 'user-a' });
      });
      withRequestContext('req-b', () => {
        setContext('req-b', { ...sampleCtx, userId: 'user-b' });
      });
      // After scope exits, context should not be accessible
      expect(getContext('req-a')).toBeUndefined();
      expect(getContext('req-b')).toBeUndefined();
    });

    it('nested scopes work correctly', () => {
      withRequestContext('outer', () => {
        setContext('outer', { ...sampleCtx, userId: 'outer-user' });
        withRequestContext('inner', () => {
          setContext('inner', { ...sampleCtx, userId: 'inner-user' });
          expect(getContext('outer')).toBeUndefined(); // different scope
          expect(getContext('inner')!.userId).toBe('inner-user');
        });
      });
    });

    it('setContext outside scope is a no-op', () => {
      // Should not throw
      expect(() => setContext('no-scope', { ...sampleCtx })).not.toThrow();
    });
  });

  describe('withRequestId + getCurrentRequestId', () => {
    it('stores and retrieves requestId', () => {
      withRequestId('req-abc', () => {
        expect(getCurrentRequestId()).toBe('req-abc');
      });
    });

    it('returns undefined outside scope', () => {
      expect(getCurrentRequestId()).toBeUndefined();
    });

    it('nested scopes isolate requestIds', () => {
      withRequestId('outer', () => {
        withRequestId('inner', () => {
          expect(getCurrentRequestId()).toBe('inner');
        });
        expect(getCurrentRequestId()).toBe('outer');
      });
    });
  });

  describe('generateRequestId', () => {
    it('generates a valid UUID string', () => {
      const id = generateRequestId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('getCachedContext / cacheContext / invalidateContext', () => {
    it('getCachedContext calls redisCache.get with correct prefix', async () => {
      mockCacheGet.mockResolvedValue(sampleCtx);
      const result = await getCachedContext('hash-123');
      expect(mockCacheGet).toHaveBeenCalledWith('auth:context:hash-123');
      expect(result).toEqual(sampleCtx);
    });

    it('getCachedContext returns null on cache miss', async () => {
      mockCacheGet.mockResolvedValue(null);
      const result = await getCachedContext('hash-miss');
      expect(result).toBeNull();
    });

    it('cacheContext calls redisCache.set with TTL', async () => {
      await cacheContext('hash-456', { ...sampleCtx });
      expect(mockCacheSet).toHaveBeenCalledWith('auth:context:hash-456', { ...sampleCtx }, 300);
    });

    it('invalidateContext calls redisCache.del', async () => {
      await invalidateContext('hash-789');
      expect(mockCacheDel).toHaveBeenCalledWith('auth:context:hash-789');
    });
  });

  describe('getOrFetchContext', () => {
    it('returns request-scoped context if available (fastest path)', async () => {
      await withRequestContext('req-fast', async () => {
        setContext('req-fast', { ...sampleCtx, userId: 'cached-req' });
        const result = await getOrFetchContext('req-fast', 'tok-hash', async () => {
          throw new Error('Should not be called');
        });
        expect(result.userId).toBe('cached-req');
      });
    });

    it('fetches from global cache if not in request scope', async () => {
      mockCacheGet.mockResolvedValue({ ...sampleCtx, userId: 'from-redis' });
      const result = await getOrFetchContext('req-new', 'tok-redis', async () => {
        throw new Error('Should not be called');
      });
      expect(result.userId).toBe('from-redis');
    });

    it('populates request-scoped cache from global cache', async () => {
      mockCacheGet.mockResolvedValue({ ...sampleCtx, userId: 'redis-ctx' });
      await withRequestContext('req-populate', async () => {
        const result = await getOrFetchContext('req-populate', 'tok-pop', async () => {
          throw new Error('Should not be called');
        });
        expect(result.userId).toBe('redis-ctx');
        // Should also be in request-scoped cache now
        const cached = getContext('req-populate');
        expect(cached).toBeDefined();
        expect(cached!.userId).toBe('redis-ctx');
      });
    });

    it('fetches from database and caches in both scopes', async () => {
      mockCacheGet.mockResolvedValue(null);
      mockCacheSet.mockResolvedValue(undefined);
      const fetchFn = vi.fn(async () => ({ ...sampleCtx, userId: 'from-db' }));
      const result = await getOrFetchContext('req-db', 'tok-db', fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.userId).toBe('from-db');
      // Should cache in global cache
      expect(mockCacheSet).toHaveBeenCalledWith(
        'auth:context:tok-db',
        { ...sampleCtx, userId: 'from-db' },
        300,
      );
    });

    it('caches fetch result in request-scoped cache too', async () => {
      mockCacheGet.mockResolvedValue(null);
      mockCacheSet.mockResolvedValue(undefined);
      await withRequestContext('req-scoped-db', async () => {
        await getOrFetchContext('req-scoped-db', 'tok-scoped', async () => ({
          ...sampleCtx,
          userId: 'db-user',
        }));
        const ctx = getContext('req-scoped-db');
        expect(ctx).toBeDefined();
        expect(ctx!.userId).toBe('db-user');
      });
    });
  });

  describe('batchGetContexts', () => {
    it('returns map of cached contexts', async () => {
      mockCacheGet
        .mockResolvedValueOnce({ ...sampleCtx, userId: 'user-1' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...sampleCtx, userId: 'user-3' });
      const result = await batchGetContexts(['hash-1', 'hash-2', 'hash-3']);
      expect(result.size).toBe(2);
      expect(result.get('hash-1')!.userId).toBe('user-1');
      expect(result.get('hash-3')!.userId).toBe('user-3');
      expect(result.has('hash-2')).toBe(false);
    });

    it('returns empty map for empty input', async () => {
      const result = await batchGetContexts([]);
      expect(result.size).toBe(0);
    });

    it('returns empty map when nothing cached', async () => {
      mockCacheGet.mockResolvedValue(null);
      const result = await batchGetContexts(['a', 'b']);
      expect(result.size).toBe(0);
    });
  });

  describe('requestContext default export', () => {
    it('has all expected methods', () => {
      expect(requestContext.get).toBe(getContext);
      expect(requestContext.set).toBe(setContext);
      expect(requestContext.getCached).toBe(getCachedContext);
      expect(requestContext.cache).toBe(cacheContext);
      expect(requestContext.invalidate).toBe(invalidateContext);
      expect(requestContext.with).toBe(withRequestContext);
      expect(requestContext.getOrFetch).toBe(getOrFetchContext);
      expect(requestContext.generateId).toBe(generateRequestId);
      expect(requestContext.batchGet).toBe(batchGetContexts);
    });
  });
});
