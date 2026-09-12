import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Cache Module - Extended', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Ensure no Redis configured so we use memory fallback
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('cache index (memory fallback)', () => {
    it('set and get a value', async () => {
      const { cache } = await import('@/lib/cache');
      await cache.set('test-key', { data: 'hello' }, 60);
      const result = await cache.get('test-key');
      expect(result).toEqual({ data: 'hello' });
    });

    it('returns null for missing key', async () => {
      const { cache } = await import('@/lib/cache');
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('expires values after TTL', async () => {
      const { cache } = await import('@/lib/cache');
      await cache.set('expire-test', 'value', 1); // 1 second
      const before = await cache.get('expire-test');
      expect(before).toBe('value');

      await new Promise(r => setTimeout(r, 1100));
      const after = await cache.get('expire-test');
      expect(after).toBeNull();
    });

    it('deletes a key', async () => {
      const { cache } = await import('@/lib/cache');
      await cache.set('del-test', 'to-delete');
      expect(await cache.get('del-test')).toBe('to-delete');
      await cache.del('del-test');
      expect(await cache.get('del-test')).toBeNull();
    });

    it('checks key existence', async () => {
      const { cache } = await import('@/lib/cache');
      await cache.set('exists-test', 'yes');
      expect(await cache.exists('exists-test')).toBe(true);
      expect(await cache.exists('missing-key')).toBe(false);
    });

    it('increments a counter', async () => {
      const { cache } = await import('@/lib/cache');
      const v1 = await cache.incr('counter-test', 60);
      expect(v1).toBe(1);
      const v2 = await cache.incr('counter-test', 60);
      expect(v2).toBe(2);
    });

    it('delete by pattern in memory', async () => {
      const { cache } = await import('@/lib/cache');
      await cache.set('pat:a:1', 'v1');
      await cache.set('pat:a:2', 'v2');
      await cache.set('pat:b:1', 'v3');
      await cache.delByPattern('pat:a:*');
      expect(await cache.get('pat:a:1')).toBeNull();
      expect(await cache.get('pat:a:2')).toBeNull();
      expect(await cache.get('pat:b:1')).toBe('v3');
    });

    it('getOrSet uses fallback when cache empty', async () => {
      const { cache } = await import('@/lib/cache');
      let calls = 0;
      const result = await cache.getOrSet('gos-test', async () => {
        calls++;
        return { computed: 'value' };
      }, 60);
      expect(result).toEqual({ computed: 'value' });
      expect(calls).toBe(1);

      const cached = await cache.getOrSet('gos-test', async () => {
        calls++;
        return { computed: 'new' };
      }, 60);
      expect(cached).toEqual({ computed: 'value' });
      expect(calls).toBe(1);
    });

    it('getOrSetStale returns cached value when available', async () => {
      const { cache } = await import('@/lib/cache');
      await cache.set('goss-test', 'fresh-value', 60);
      const result = await cache.getOrSetStale('goss-test', async () => 'new-value', 60);
      expect(result).toBe('fresh-value');
    });

    it('warm skips without a lock in memory fallback (fail-closed, #M3)', async () => {
      const { cache } = await import('@/lib/cache');
      delete process.env['LOCK_FAIL_OPEN'];
      let called = false;
      await cache.warm('warm-test', async () => {
        called = true;
        return 'warm-value';
      }, 60);
      // No Redis available so the distributed lock cannot be acquired and
      // fail-closed warming must not run the fallback.
      expect(called).toBe(false);
      expect(await cache.get('warm-test')).toBeNull();
    });

    it('warm only sets if key missing (fail-open legacy mode)', async () => {
      process.env['LOCK_FAIL_OPEN'] = 'true';
      const { cache } = await import('@/lib/cache');
      await cache.warm('warm-test', async () => 'warm-value', 60);
      expect(await cache.get('warm-test')).toBe('warm-value');

      let secondCall = false;
      await cache.warm('warm-test', async () => {
        secondCall = true;
        return 'should-not-replace';
      }, 60);
      expect(secondCall).toBe(false);
      expect(await cache.get('warm-test')).toBe('warm-value');
    });

    it('invalidates tenant cache', async () => {
      const { cache } = await import('@/lib/cache');
      await cache.set('tenant:t1:config', 'cfg');
      await cache.set('query:t1:contacts', 'contacts');
      await cache.invalidateTenantCache('t1');
      expect(await cache.get('tenant:t1:config')).toBeNull();
      expect(await cache.get('query:t1:contacts')).toBeNull();
    });

    it('returns health status as degraded without Redis', async () => {
      const { cache } = await import('@/lib/cache');
      const result = await cache.health();
      expect(result.status).toBe('degraded');
    });

    it('rate limit check with memory fallback', async () => {
      const { cache } = await import('@/lib/cache');
      const r1 = await cache.rateLimit.check('rl-test', 3, 60);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = await cache.rateLimit.check('rl-test', 3, 60);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = await cache.rateLimit.check('rl-test', 3, 60);
      expect(r3.allowed).toBe(true);

      const r4 = await cache.rateLimit.check('rl-test', 3, 60);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
    });

    it('session cache helper works', async () => {
      const { session } = await import('@/lib/cache');
      await session.set('token-abc', 'user-1');
      const userId = await session.get('token-abc');
      expect(userId).toBe('user-1');
      await session.delete('token-abc');
      expect(await session.get('token-abc')).toBeNull();
    });
  });

  describe('cache/queries', () => {
    it('caches and retrieves query results', async () => {
      const { cacheQuery, getCachedQuery } = await import('@/lib/cache/queries');
      await cacheQuery('my-query-key', { rows: [1, 2, 3] });
      const result = await getCachedQuery('my-query-key');
      expect(result).toEqual({ rows: [1, 2, 3] });
    });

    it('getQueryOrFetch uses fetch when cache missed', async () => {
      const { getQueryOrFetch } = await import('@/lib/cache/queries');
      let calls = 0;
      const result = await getQueryOrFetch('fetch-test', async () => {
        calls++;
        return { fresh: true };
      });
      expect(result).toEqual({ fresh: true });
      expect(calls).toBe(1);
    });

    it('invalidates a cached query', async () => {
      const { cacheQuery, getCachedQuery, invalidateQuery } = await import('@/lib/cache/queries');
      await cacheQuery('inval-test', 'data');
      expect(await getCachedQuery('inval-test')).toBe('data');
      await invalidateQuery('inval-test');
      expect(await getCachedQuery('inval-test')).toBeNull();
    });

    it('invalidates tenant queries', async () => {
      const { cacheQuery, getCachedQuery, invalidateTenantQueries } = await import('@/lib/cache/queries');
      await cacheQuery('query:t1:list', 't1-data');
      await cacheQuery('query:t2:list', 't2-data');
      await invalidateTenantQueries('t1');
      expect(await getCachedQuery('query:t1:list')).toBeNull();
      expect(await getCachedQuery('query:t2:list')).toBe('t2-data');
    });

    it('QueryKeys generates correct cache keys', async () => {
      const { QueryKeys } = await import('@/lib/cache/queries');
      expect(QueryKeys.contactsList('t1', 1, 20)).toBe('t1:contacts:list:1:20');
      expect(QueryKeys.dealsList('t1', 'qualified')).toBe('t1:deals:list:qualified');
      expect(QueryKeys.tasksList('t1')).toBe('t1:tasks:list:all');
      expect(QueryKeys.dashboardStats('t1')).toBe('t1:dashboard:stats');
      expect(QueryKeys.tenantConfig('t1')).toBe('tenant:t1:config');
    });

    it('CacheTTL has expected values', async () => {
      const { CacheTTL } = await import('@/lib/cache/queries');
      expect(CacheTTL.short).toBe(60);
      expect(CacheTTL.medium).toBe(300);
      expect(CacheTTL.long).toBe(3600);
      expect(CacheTTL.veryLong).toBe(86400);
    });

    it('cachedQuery decorator returns a decorator function', async () => {
      const { cachedQuery, CacheTTL } = await import('@/lib/cache/queries');
      const decorator = cachedQuery({ key: () => 'test:query', ttl: CacheTTL.short });
      expect(typeof decorator).toBe('function');
    });

    it('invalidateCache decorator returns a decorator function', async () => {
      const { invalidateCache } = await import('@/lib/cache/queries');
      const decorator = invalidateCache(['contacts:list']);
      expect(typeof decorator).toBe('function');
    });
  });

  describe('cache/sessions', () => {
    it('caches and retrieves sessions', async () => {
      const { cacheSession, getSession, deleteSession, sessionExists, refreshSession } = await import('@/lib/cache/sessions');
      await cacheSession('token-xyz', 'user-2', 'tenant-2');
      const session = await getSession('token-xyz');
      expect(session).toBeDefined();
      expect(session!.userId).toBe('user-2');
      expect(session!.tenantId).toBe('tenant-2');

      expect(await sessionExists('token-xyz')).toBe(true);
      expect(await sessionExists('no-such-token')).toBe(false);

      await refreshSession('token-xyz');
      expect(await getSession('token-xyz')).toBeDefined();

      await deleteSession('token-xyz');
      expect(await getSession('token-xyz')).toBeNull();
    });

    it('sessionCount returns 0 (placeholder)', async () => {
      const { getSessionCount } = await import('@/lib/cache/sessions');
      expect(await getSessionCount()).toBe(0);
    });

    it('deleteUserSessions logs warning', async () => {
      const { deleteUserSessions } = await import('@/lib/cache/sessions');
      await expect(deleteUserSessions('user-1')).resolves.not.toThrow();
    });

    it('sessionCache namespace has all methods', async () => {
      const { sessionCache } = await import('@/lib/cache/sessions');
      expect(sessionCache.cacheSession).toBeDefined();
      expect(sessionCache.getSession).toBeDefined();
      expect(sessionCache.deleteSession).toBeDefined();
      expect(sessionCache.refreshSession).toBeDefined();
      expect(sessionCache.sessionExists).toBeDefined();
      expect(sessionCache.deleteUserSessions).toBeDefined();
      expect(sessionCache.getSessionCount).toBeDefined();
    });
  });
});
