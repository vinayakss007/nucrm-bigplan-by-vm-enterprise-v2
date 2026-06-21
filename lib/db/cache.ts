/**
 * Server-Side In-Memory Cache
 * Used for hot read-only data like tenant settings and plans
 *
 * FIXED: O(1) eviction using insertion-order Map iteration
 * instead of O(n log n) sort on every eviction.
 *
 * FIXED: Cache stampede protection via shared promises.
 */


// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CacheEntry { data: any; expires: number; }
const _cache = new Map<string, CacheEntry>();
const _pending = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 500;

/**
 * Evict expired entries first, then evict oldest by insertion order.
 * O(1) amortised — no sorting required.
 */
function evict(): void {
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (entry.expires <= now) {
      _cache.delete(key);
      if (_cache.size < MAX_CACHE_ENTRIES) return;
    }
  }

  if (_cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
}

/**
 * Get data from cache or fetch and store it.
 * Includes stampede protection: concurrent requests for the same key
 * share a single fetch promise.
 */
export function dbCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.data as T);

  if (hit) _cache.delete(key);

  const pending = _pending.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then(data => {
      if (_cache.size >= MAX_CACHE_ENTRIES) evict();
      _cache.set(key, { data, expires: Date.now() + ttlMs });
      _pending.delete(key);
      return data;
    })
    .catch(err => {
      _pending.delete(key);
      throw err;
    });

  _pending.set(key, promise);
  return promise;
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
