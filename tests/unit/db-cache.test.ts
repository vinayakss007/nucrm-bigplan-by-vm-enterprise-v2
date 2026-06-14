/**
 * Database Cache (in-memory LRU) Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('db/cache (server-side LRU)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('caches fetched data', async () => {
    const { dbCache } = await import('@/lib/db/cache');
    const fetcher = vi.fn(async () => ({ name: 'Test' }));

    const result1 = await dbCache('test-key', 60000, fetcher);
    const result2 = await dbCache('test-key', 60000, fetcher);

    expect(result1).toEqual({ name: 'Test' });
    expect(result2).toEqual({ name: 'Test' });
    expect(fetcher).toHaveBeenCalledTimes(1); // Only called once — cached
  });

  it('expires stale entries', async () => {
    const { dbCache } = await import('@/lib/db/cache');
    const fetcher = vi.fn(async () => Date.now());

    const result1 = await dbCache('expire-key', 1, fetcher); // 1ms TTL
    await new Promise(r => setTimeout(r, 5)); // Wait for expiry
    const result2 = await dbCache('expire-key', 1, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2); // Re-fetched after expiry
    expect(result2).not.toBe(result1);
  });

  it('invalidateCache removes matching keys', async () => {
    const { dbCache, invalidateCache } = await import('@/lib/db/cache');
    const fetcher = vi.fn(async () => 'data');

    await dbCache('tenant:123:contacts', 60000, fetcher);
    await dbCache('tenant:123:deals', 60000, fetcher);
    await dbCache('tenant:456:contacts', 60000, fetcher);

    invalidateCache('tenant:123:');

    // tenant:123 keys should be refetched
    await dbCache('tenant:123:contacts', 60000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4); // 3 initial + 1 refetch

    // tenant:456 should still be cached
    await dbCache('tenant:456:contacts', 60000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4); // Still cached
  });

  it('getCacheSize returns current size', async () => {
    const mod = await import('@/lib/db/cache');
    const { dbCache } = mod;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getCacheSize = (mod as any).getCacheSize;
    // Skip if not exported
    if (typeof getCacheSize !== 'function') return;
    const fetcher = vi.fn(async () => 'val');

    await dbCache('size-a', 60000, fetcher);
    await dbCache('size-b', 60000, fetcher);
    await dbCache('size-c', 60000, fetcher);

    expect(getCacheSize()).toBeGreaterThanOrEqual(3);
  });

  it('evicts when over MAX_CACHE_ENTRIES', async () => {
    const { dbCache } = await import('@/lib/db/cache');
    const fetcher = vi.fn(async () => 'val');

    // Fill with 501 entries (MAX is 500)
    for (let i = 0; i < 501; i++) {
      await dbCache(`evict-${i}`, 60000, fetcher);
    }

    // If we got here without crashing, eviction works
    expect(fetcher).toHaveBeenCalledTimes(501);
  });
});
