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
});
