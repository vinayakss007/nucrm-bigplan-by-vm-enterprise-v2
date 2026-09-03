import { describe, it, expect } from 'vitest';
import { cacheGet, cacheSet, cacheDel, withCache } from '@/lib/cache/redis';

describe('Cache (memory fallback)', () => {
  it('stores and retrieves values', async () => {
    await cacheSet('test:1', { hello: 'world' });
    const result = await cacheGet<{ hello: string }>('test:1');
    expect(result).toEqual({ hello: 'world' });
  });

  it('returns null for missing keys', async () => {
    const result = await cacheGet('nonexistent:key');
    expect(result).toBeNull();
  });

  it('deletes by pattern', async () => {
    await cacheSet('del:test:1', 'value1');
    await cacheSet('del:test:2', 'value2');
    await cacheDel('del:test:*');
    const r1 = await cacheGet('del:test:1');
    const r2 = await cacheGet('del:test:2');
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it('withCache uses fetcher on cache miss', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return { data: 'fresh' }; };

    const first = await withCache('withcache:test', fetcher);
    expect(first).toEqual({ data: 'fresh' });
    expect(calls).toBe(1);

    const second = await withCache('withcache:test', fetcher);
    expect(second).toEqual({ data: 'fresh' });
    expect(calls).toBe(1); // Cached, fetcher not called again
  });

  it('withCache calls fetcher again after ttl expires', async () => {
    let calls = 0;
    const fetcher = async () => { calls++; return { data: 'fresh' }; };

    await cacheSet('ttl:test', { data: 'old' }, 1); // 1 second TTL
    const cached = await cacheGet('ttl:test');
    expect(cached).toEqual({ data: 'old' });

    // Wait 1.5 seconds for TTL to expire
    await new Promise(r => setTimeout(r, 1100));
    const fresh = await withCache('ttl:test', fetcher, 60);
    expect(fresh).toEqual({ data: 'fresh' });
    expect(calls).toBe(1);
  }, 5000);

  it('evicts correctly based on LRU and size limits', async () => {
    // Fill up to the limit MAX_CACHE_ENTRIES=1000
    for (let i = 0; i < 1000; i++) {
      await cacheSet(`lru:test:${i}`, `value${i}`);
    }

    // Ensure the first items are still present
    const firstItem = await cacheGet('lru:test:0');
    expect(firstItem).toBe('value0'); // This also moves it to the end (MRU)

    // Add one more item to exceed 1000 items
    await cacheSet('lru:test:1000', 'value1000');

    // The least recently used item should now be 'lru:test:1' because 'lru:test:0' was accessed and moved to the end.
    const evictedItem = await cacheGet('lru:test:1');
    expect(evictedItem).toBeNull(); // Should be evicted

    const mruItem = await cacheGet('lru:test:0');
    expect(mruItem).toBe('value0'); // Should still be present

    const newestItem = await cacheGet('lru:test:1000');
    expect(newestItem).toBe('value1000');
  });
});
