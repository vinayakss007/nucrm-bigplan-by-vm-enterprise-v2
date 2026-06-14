/**
 * Server-Side In-Memory Cache
 * Used for hot read-only data like tenant settings and plans
 * 
 * FIXED: O(1) eviction using insertion-order Map iteration
 * instead of O(n log n) sort on every eviction.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CacheEntry { data: any; expires: number; }
const _cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

/**
 * Evict expired entries first, then evict oldest by insertion order.
 * O(1) amortised — no sorting required.
 */
function evict(): void {
  // Phase 1: Remove expired entries (cheap — stop after clearing enough)
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (entry.expires <= now) {
      _cache.delete(key);
      if (_cache.size < MAX_CACHE_ENTRIES) return;
    }
  }

  // Phase 2: If still over limit, evict oldest by insertion order (Map iterates in insertion order)
  if (_cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
}

/**
 * Get data from cache or fetch and store it
 */
export function dbCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.data as T);

  // Remove stale entry if present
  if (hit) _cache.delete(key);

  return fetcher().then(data => {
    if (_cache.size >= MAX_CACHE_ENTRIES) {
      evict();
    }
    _cache.set(key, { data, expires: Date.now() + ttlMs });
    return data;
  });
}

/**
 * Invalidate cache by prefix
 */
export function invalidateCache(prefix: string) {
  for (const key of _cache.keys()) {
    if (key.startsWith(prefix)) {
      _cache.delete(key);
    }
  }
}

/**
 * Get current cache size (for monitoring)
 */
export function getCacheSize(): number {
  return _cache.size;
}
