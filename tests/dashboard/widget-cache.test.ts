import { describe, it, expect, beforeEach } from 'vitest';
import { withCache, invalidateWidgetCache, getCacheStats, clearCache } from '@/lib/dashboard/widget-cache';

describe('widget-cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('caches data and returns it within TTL', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { value: 42 };
    };

    const result1 = await withCache('tenant-1', 'test-widget', 60, fetcher);
    expect(result1).toEqual({ value: 42 });
    expect(callCount).toBe(1);

    const result2 = await withCache('tenant-1', 'test-widget', 60, fetcher);
    expect(result2).toEqual({ value: 42 });
    expect(callCount).toBe(1);
  });

  it('refetches after TTL expires', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { value: callCount };
    };

    await withCache('tenant-1', 'ttl-test', 0, fetcher);
    await withCache('tenant-1', 'ttl-test', 0, fetcher);
    expect(callCount).toBe(2);
  });

  it('isolates caches per tenant', async () => {
    const fetcher = async (n: number) => ({ value: n });

    await withCache('tenant-a', 'widget', 60, () => fetcher(1));
    await withCache('tenant-b', 'widget', 60, () => fetcher(2));

    const a = await withCache('tenant-a', 'widget', 60, () => fetcher(3));
    const b = await withCache('tenant-b', 'widget', 60, () => fetcher(4));

    expect(a).toEqual({ value: 1 });
    expect(b).toEqual({ value: 2 });
  });

  it('isolates caches per widget key', async () => {
    const fetcher = async (n: number) => ({ value: n });

    await withCache('t1', 'widget-a', 60, () => fetcher(10));
    await withCache('t1', 'widget-b', 60, () => fetcher(20));

    const a = await withCache('t1', 'widget-a', 60, () => fetcher(30));
    const b = await withCache('t1', 'widget-b', 60, () => fetcher(40));

    expect(a).toEqual({ value: 10 });
    expect(b).toEqual({ value: 20 });
  });

  it('invalidates specific cache entries', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { value: callCount };
    };

    await withCache('t1', 'w1', 60, fetcher);
    await withCache('t1', 'w2', 60, fetcher);
    expect(callCount).toBe(2);

    invalidateWidgetCache('t1', 'w1');

    await withCache('t1', 'w1', 60, fetcher);
    expect(callCount).toBe(3);

    await withCache('t1', 'w2', 60, fetcher);
    expect(callCount).toBe(3);
  });

  it('reports cache stats', () => {
    expect(getCacheStats()).toEqual({ size: 0, maxEntries: 500 });
  });

  it('handles fetcher errors gracefully', async () => {
    const badFetcher = async () => { throw new Error('DB down'); };
    await expect(withCache('t1', 'err', 60, badFetcher)).rejects.toThrow('DB down');
  });
});
