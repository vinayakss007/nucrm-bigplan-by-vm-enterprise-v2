/**
 * Server-Side In-Memory Cache
 * Used for hot read-only data like tenant settings and plans
 */

interface CacheEntry { data: any; expires: number; }
const _cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

/**
 * Get data from cache or fetch and store it
 */
export function dbCache<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.data as T);
  return fetcher().then(data => {
    if (_cache.size >= MAX_CACHE_ENTRIES) {
      // Evict oldest entry
      const oldest = [..._cache.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
      if (oldest) _cache.delete(oldest[0]);
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
