/**
 * Tests for lib/api/list-count.ts (issue #1544 F2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for lib/cache getOrSet: memoises per key.
const store = new Map<string, unknown>();
let getOrSetCalls = 0;
let failMode = false;

vi.mock('@/lib/cache/index', () => ({
  getOrSet: vi.fn(async (key: string, fn: () => Promise<unknown>) => {
    getOrSetCalls++;
    if (failMode) throw new Error('cache down');
    if (store.has(key)) return store.get(key);
    const v = await fn();
    store.set(key, v);
    return v;
  }),
}));

import { cachedListCount, buildFilterKey } from '@/lib/api/list-count';

describe('buildFilterKey', () => {
  it('is order-independent and stable', () => {
    expect(buildFilterKey({ q: 'x', status: 'a' })).toBe(buildFilterKey({ status: 'a', q: 'x' }));
  });
  it('drops empty/undefined/null values', () => {
    expect(buildFilterKey({ q: '', status: undefined, company_id: null, leadStatus: 'new' }))
      .toBe('leadStatus=new');
  });
  it('returns "all" when no filters', () => {
    expect(buildFilterKey({ q: undefined })).toBe('all');
  });
});

describe('cachedListCount', () => {
  beforeEach(() => { store.clear(); getOrSetCalls = 0; failMode = false; });

  it('computes once then serves from cache for the same key', async () => {
    const compute = vi.fn(async () => 42);
    const a = await cachedListCount('t1', 'contacts', 'all', compute);
    const b = await cachedListCount('t1', 'contacts', 'all', compute);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1); // second hit served from cache
  });

  it('uses a tenant+resource+filter scoped key (different filters recompute)', async () => {
    const c1 = vi.fn(async () => 1);
    const c2 = vi.fn(async () => 2);
    expect(await cachedListCount('t1', 'contacts', 'q=alice', c1)).toBe(1);
    expect(await cachedListCount('t1', 'contacts', 'q=bob', c2)).toBe(2);
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
  });

  it('falls back to compute() when the cache throws (correctness preserved)', async () => {
    failMode = true;
    const compute = vi.fn(async () => 7);
    const v = await cachedListCount('t1', 'contacts', 'all', compute);
    expect(v).toBe(7);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
