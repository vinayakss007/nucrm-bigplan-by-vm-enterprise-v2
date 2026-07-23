import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCacheGet = vi.fn();
const mockCacheSet = vi.fn();
const mockCacheDel = vi.fn();

vi.mock('@/lib/cache/index', () => ({
  cache: {
    get: mockCacheGet,
    set: mockCacheSet,
    del: mockCacheDel,
  },
}));

describe('tenant/request-context', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('generateRequestId', () => {
    it('generates a string starting with req_', async () => {
      const { generateRequestId } = await import('@/lib/tenant/request-context');
      const id = generateRequestId();
      expect(id).toMatch(/^req_\d+_/);
    });
  });

  describe('withRequestId', () => {
    it('executes function with requestId in context', async () => {
      const { withRequestId } = await import('@/lib/tenant/request-context');
      const result = withRequestId('req-123', () => 'done');
      expect(result).toBe('done');
    });
  });

  describe('withRequestContext', () => {
    it('executes function with request context store', async () => {
      const { withRequestContext } = await import('@/lib/tenant/request-context');
      const result = withRequestContext('req-123', () => 'context-ready');
      expect(result).toBe('context-ready');
    });
  });

  describe('setContext and getContext', () => {
    it('stores and retrieves context within a request scope', async () => {
      const { withRequestContext, setContext, getContext } = await import('@/lib/tenant/request-context');
      withRequestContext('req-1', () => {
        setContext('req-1', {
          userId: 'u1',
          tenantId: 't1',
          roleSlug: 'admin',
          permissions: { read: true },
          isAdmin: true,
          isSuperAdmin: false,
          cachedAt: Date.now(),
        });
        const ctx = getContext('req-1');
        expect(ctx).toBeDefined();
        expect(ctx!.userId).toBe('u1');
      });
    });

    it('returns undefined for unknown requestId', async () => {
      const { getContext } = await import('@/lib/tenant/request-context');
      const ctx = getContext('nonexistent');
      expect(ctx).toBeUndefined();
    });
  });

  describe('getCachedContext and cacheContext', () => {
    it('returns cached context from global cache', async () => {
      const ctx = { userId: 'u1', tenantId: 't1', roleSlug: 'admin', permissions: {}, isAdmin: true, isSuperAdmin: false, cachedAt: 123 };
      mockCacheGet.mockResolvedValue(ctx);

      const { getCachedContext } = await import('@/lib/tenant/request-context');
      const result = await getCachedContext('token-hash');
      expect(result).toEqual(ctx);
    });

    it('returns null when not cached', async () => {
      mockCacheGet.mockResolvedValue(null);

      const { getCachedContext } = await import('@/lib/tenant/request-context');
      const result = await getCachedContext('token-hash');
      expect(result).toBeNull();
    });

    it('caches context with TTL', async () => {
      const ctx = { userId: 'u1', tenantId: 't1', roleSlug: 'admin', permissions: {}, isAdmin: true, isSuperAdmin: false, cachedAt: 123 };

      const { cacheContext } = await import('@/lib/tenant/request-context');
      await cacheContext('token-hash', ctx);
      expect(mockCacheSet).toHaveBeenCalledWith('auth:context:token-hash', ctx, 300);
    });
  });

  describe('invalidateContext', () => {
    it('deletes cached context', async () => {
      const { invalidateContext } = await import('@/lib/tenant/request-context');
      await invalidateContext('token-hash');
      expect(mockCacheDel).toHaveBeenCalledWith('auth:context:token-hash');
    });
  });

  describe('getOrFetchContext', () => {
    it('returns from request-scoped cache if available', async () => {
      const ctx = { userId: 'u1', tenantId: 't1', roleSlug: 'admin', permissions: {}, isAdmin: true, isSuperAdmin: false, cachedAt: 123 };
      const fetchFn = vi.fn();

      const { withRequestContext, setContext, getOrFetchContext } = await import('@/lib/tenant/request-context');
      const result = withRequestContext('req-1', async () => {
        (globalThis as any).__request_ctx = ctx;
        setContext('req-1', ctx);
        return getOrFetchContext('req-1', 'hash', fetchFn);
      });

      await result;
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });
});
