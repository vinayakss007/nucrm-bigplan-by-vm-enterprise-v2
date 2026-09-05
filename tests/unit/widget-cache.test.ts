import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('widget-cache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('caches and returns data on cache miss', async () => {
    const data = { widgets: [{ id: 'w1', title: 'Sales' }] };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    const result = await withCache('tenant-1', 'sales-pipeline', 60, fetcher);
    const body = await result.json();
    expect(body).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns cached data on cache hit within TTL', async () => {
    const data = { widgets: [{ id: 'w1' }] };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    await withCache('tenant-1', 'widget-a', 300, fetcher);
    const result2 = await withCache('tenant-1', 'widget-a', 300, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = await result2.json();
    expect(body).toEqual(data);
  });

  it('calls fetcher again after TTL expires', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ val: 1 }), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    await withCache('tenant-1', 'key', 0, fetcher);
    await withCache('tenant-1', 'key', 0, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent fetches for the same key', async () => {
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise(r => setTimeout(r, 50));
      return new Response(JSON.stringify({ count: callCount }), { headers: { 'content-type': 'application/json' } });
    });
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    const [r1, r2] = await Promise.all([
      withCache('tenant-1', 'dup', 60, fetcher),
      withCache('tenant-1', 'dup', 60, fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1).toEqual(b2);
  });

  it('deduplicates with cloned response for concurrent calls', async () => {
    const data = { widgets: [] };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    const [r1, r2] = await Promise.all([
      withCache('t1', 'k', 60, fetcher),
      withCache('t1', 'k', 60, fetcher),
    ]);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1).toEqual(data);
    expect(b2).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('handles fetcher errors and does not cache', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    await expect(withCache('tenant-1', 'err-key', 60, fetcher)).rejects.toThrow('Network error');
    await expect(withCache('tenant-1', 'err-key', 60, fetcher)).rejects.toThrow('Network error');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('separates cache by tenantId', async () => {
    const dataA = { val: 'A' };
    const dataB = { val: 'B' };
    const fetcherA = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dataA), { headers: { 'content-type': 'application/json' } }),
    );
    const fetcherB = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dataB), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    await withCache('tenant-a', 'widget', 60, fetcherA);
    await withCache('tenant-b', 'widget', 60, fetcherB);
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  it('separates cache by widgetKey within same tenant', async () => {
    const dataX = { x: 1 };
    const dataY = { y: 2 };
    const fetcherX = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dataX), { headers: { 'content-type': 'application/json' } }),
    );
    const fetcherY = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(dataY), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    await withCache('t', 'widget-x', 60, fetcherX);
    await withCache('t', 'widget-y', 60, fetcherY);
    expect(fetcherX).toHaveBeenCalledTimes(1);
    expect(fetcherY).toHaveBeenCalledTimes(1);
  });

  it('invalidateWidgetCache removes specific entries', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, invalidateWidgetCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    await withCache('t', 'a', 60, fetcher);
    await withCache('t', 'b', 60, fetcher);
    invalidateWidgetCache('t', 'a');
    await withCache('t', 'a', 60, fetcher);
    await withCache('t', 'b', 60, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('getCacheStats returns size and maxEntries', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } }),
    );
    const { getCacheStats, clearCache, withCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    const stats = getCacheStats();
    expect(stats).toHaveProperty('size');
    expect(stats).toHaveProperty('maxEntries');
    expect(stats.maxEntries).toBe(500);
    expect(stats.size).toBe(0);

    await withCache('t1', 'k1', 60, fetcher);
    await withCache('t1', 'k2', 60, fetcher);

    const statsAfter = getCacheStats();
    expect(statsAfter.size).toBe(2);
  });

  it('clearCache clears all entries', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ x: 1 }), { headers: { 'content-type': 'application/json' } }),
    );
    const { withCache, clearCache, getCacheStats } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    await withCache('t', 'k', 60, fetcher);
    clearCache();
    await withCache('t', 'k', 60, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const stats = getCacheStats();
    expect(stats.size).toBe(1);
  });

  it('evicts oldest entries when cache exceeds MAX_ENTRIES', async () => {
    const { withCache, clearCache } = await import('@/lib/dashboard/widget-cache');
    clearCache();
    const fetchers: ReturnType<typeof vi.fn>[] = [];
    for (let i = 0; i < 550; i++) {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ i }), { headers: { 'content-type': 'application/json' } }),
      );
      fetchers.push(fetcher);
      await withCache('t', `k-${i}`, 99999, fetcher);
    }
    const calledCount = fetchers.filter(f => f.mock.calls.length > 0).length;
    expect(calledCount).toBe(550);
    const { getCacheStats } = await import('@/lib/dashboard/widget-cache');
    const stats = getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(500);
  });
});
