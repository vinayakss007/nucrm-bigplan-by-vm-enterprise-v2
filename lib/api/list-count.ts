/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Cached list-count helper (issue #1544 F2).
 *
 * List endpoints return an exact `total` computed with
 * `SELECT count(*) … WHERE <same filters as the page>`. In Postgres an exact
 * filtered count is inherently O(matching-rows) — no index makes it sub-linear
 * (verified: even an Index-Only Scan still does one heap/index touch per
 * matching row). At 50k–1M rows/tenant this Seq/Index scan dominates the cost
 * of every "page N" request and repeats on each keystroke of pagination.
 *
 * Since the count only needs to be *good enough* for pagination UI (it does not
 * gate correctness), we memoise it per (tenant, resource, filters) for a short
 * window. Repeated pages / rapid re-fetches within the window reuse the count
 * instead of re-scanning. The window is deliberately short so a freshly created
 * row shows up in the total within seconds. Writers may also call
 * `invalidateTenantCache(tenantId)` to drop it immediately.
 *
 * Falls back to running `compute()` directly if the cache is unavailable, so it
 * never changes correctness — only how often the scan runs.
 */
import { getOrSet } from '@/lib/cache/index';

/** Default staleness window for a cached list count. */
const DEFAULT_COUNT_TTL_SECONDS = 10;

/**
 * Return a cached list count for `resource` scoped to `tenantId`, keyed by the
 * given `filterKey` (a stable string derived from the query's filters).
 *
 * The cache key is `tenant:<tenantId>:count:<resource>:<filterKey>` so it is
 * swept by `invalidateTenantCache(tenantId)` (which clears `tenant:<id>:*`).
 */
export async function cachedListCount(
  tenantId: string,
  resource: string,
  filterKey: string,
  compute: () => Promise<number>,
  ttlSeconds: number = DEFAULT_COUNT_TTL_SECONDS,
): Promise<number> {
  const key = `tenant:${tenantId}:count:${resource}:${filterKey}`;
  try {
    return await getOrSet<number>(key, compute, ttlSeconds);
  } catch {
    // A cache-layer problem must never break the endpoint — compute directly.
    return compute();
  }
}

/**
 * Build a short, stable filter key from the query params that actually affect
 * the count. Only include values that change the WHERE clause; order-independent.
 */
export function buildFilterKey(parts: Record<string, unknown>): string {
  const entries = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v)}`)
    .sort();
  return entries.length ? entries.join('&') : 'all';
}
