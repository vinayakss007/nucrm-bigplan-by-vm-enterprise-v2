/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized distribution is prohibited.
 */

/**
 * #2688 — one tenant-wide cache entry per widget, served to whoever asked first.
 *
 * `lib/dashboard/widget-cache.ts` keyed entries as `${tenantId}:${widgetKey}`,
 * and TTLs run to 300 s. Every caller of a workspace read the first caller's
 * response — today harmless only because all thirteen widget routes read the
 * whole tenant. The moment a widget narrows to the caller's own rows, that same
 * key becomes a disclosure: rep A's numbers, cached, handed to rep B.
 *
 * These tests pin the key itself, because no amount of per-route SQL checking
 * catches it: a route can pass the right predicate and still be answered from
 * someone else's entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import {
  withCache,
  invalidateWidgetCache,
  clearCache,
  getCacheStats,
} from '@/lib/dashboard/widget-cache';

const TENANT = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function fetcher(tag: string) {
  const fn = vi.fn(async () => NextResponse.json({ data: { tag } }));
  return fn;
}

beforeEach(() => clearCache());

describe('the widget cache can express per-caller data (#2688)', () => {
  it('two callers with different scope keys do not share an entry', async () => {
    const first = fetcher('a');
    const second = fetcher('b');
    await withCache(TENANT, 'contacts-recent', 300, first, A);
    const res = await withCache(TENANT, 'contacts-recent', 300, second, B);
    expect(second).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ data: { tag: 'b' } });
  });

  it('two callers with the same scope key still share one fetch', async () => {
    // Managers get 'tenant' from `ownerCacheKey`, so the workspace-wide read is
    // computed once per window, as before. This is what keeps the fix from
    // turning every dashboard into N queries.
    const one = fetcher('shared');
    await withCache(TENANT, 'stats-pipeline', 300, one, 'tenant');
    const res = await withCache(TENANT, 'stats-pipeline', 300, one, 'tenant');
    expect(one).toHaveBeenCalledTimes(1);
    expect((await res.json()).data.tag).toBe('shared');
  });

  it('the legacy four-argument call keeps working and stays tenant-wide', async () => {
    const one = fetcher('default');
    await withCache(TENANT, 'activity', 60, one);
    const res = await withCache(TENANT, 'activity', 60, one);
    expect(one).toHaveBeenCalledTimes(1);
    expect((await res.json()).data.tag).toBe('default');
  });

  it('an in-flight fetch is de-duplicated per scope key, not per widget', async () => {
    // The `pending` map is keyed the same way the entries are. If it were not,
    // rep B's request would resolve with rep A's in-flight response and the
    // entry-level fix above would buy nothing.
    let release: (v: Response) => void = () => {};
    const slow = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const b = fetcher('b');

    const inflightA = withCache(TENANT, 'deals-closing', 300, slow, A);
    const sameAsA = withCache(TENANT, 'deals-closing', 300, slow, A);
    const asB = withCache(TENANT, 'deals-closing', 300, b, B);
    release(NextResponse.json({ data: { tag: 'a' } }));

    expect(await (await inflightA).json()).toEqual({ data: { tag: 'a' } });
    expect(await (await sameAsA).json()).toEqual({ data: { tag: 'a' } });
    expect(b).toHaveBeenCalledTimes(1);
    expect(await (await asB).json()).toEqual({ data: { tag: 'b' } });
    // A's own fetcher ran once, not twice, for two callers of one scope.
    expect(slow).toHaveBeenCalledTimes(1);
  });
});

describe('invalidation covers every caller of a widget (#2688)', () => {
  it('a write drops both callers’ entries, not just the writer’s', async () => {
    const a1 = fetcher('a1');
    await withCache(TENANT, 'contacts-recent', 300, a1, A);
    invalidateWidgetCache(TENANT, 'contacts-recent');
    const a2 = fetcher('a2');
    await withCache(TENANT, 'contacts-recent', 300, a2, A);
    expect(a2).toHaveBeenCalledTimes(1);
  });

  it('a widget write does not drop a different widget of the same tenant', async () => {
    const stats = fetcher('stats');
    await withCache(TENANT, 'stats-contacts', 30, stats, 'tenant');
    invalidateWidgetCache(TENANT, 'contacts-recent');
    await withCache(TENANT, 'stats-contacts', 30, stats, 'tenant');
    expect(stats).toHaveBeenCalledTimes(1);
  });

  it('a write in one workspace leaves another workspace’s cache alone', async () => {
    const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
    const mine = fetcher('mine');
    await withCache(OTHER_TENANT, 'contacts-recent', 300, mine, A);
    invalidateWidgetCache(TENANT, 'contacts-recent');
    await withCache(OTHER_TENANT, 'contacts-recent', 300, mine, A);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(getCacheStats().size).toBeGreaterThan(0);
  });
});
