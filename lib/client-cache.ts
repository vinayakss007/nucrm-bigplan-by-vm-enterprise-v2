const CACHE_PREFIX = 'nucrm_cache_';
const DEFAULT_TTL = 5 * 60 * 1000;

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  userId: string;
}

export interface CacheConfig {
  ttl?: number;
  staleWhileRevalidate?: boolean;
}

function getCacheKey(key: string, userId?: string): string {
  return `${CACHE_PREFIX}${userId ? `${userId}_` : ''}${key}`;
}

function isValid<T>(entry: CacheEntry<T>, userId: string): boolean {
  if (!entry) return false;
  if (entry.userId !== userId) return false;
  const age = Date.now() - entry.timestamp;
  return age < entry.ttl;
}

function isStale<T>(entry: CacheEntry<T>): boolean {
  if (!entry) return true;
  const age = Date.now() - entry.timestamp;
  return age >= entry.ttl;
}

export function getFromCache<T>(key: string, userId: string): T | null {
  try {
    const cacheKey = getCacheKey(key, userId);
    const item = localStorage.getItem(cacheKey);
    if (!item) return null;
    const entry = JSON.parse(item) as CacheEntry<T>;
    if (!isValid(entry, userId)) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    return entry.data;
  } catch (err) {
    console.error('[Cache] Get error:', err);
    return null;
  }
}

export function setInCache<T>(key: string, data: T, userId: string, config?: CacheConfig): void {
  try {
    const cacheKey = getCacheKey(key, userId);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: config?.ttl ?? DEFAULT_TTL,
      userId,
    };
    localStorage.setItem(cacheKey, JSON.stringify(entry));
    console.log(`[Cache] Stored: ${key}`);
  } catch (err) {
    console.error('[Cache] Set error:', err);
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      console.warn('[Cache] Storage quota exceeded, clearing old entries...');
      clearExpiredCache();
    }
  }
}

export function getStaleData<T>(key: string, userId: string): T | null {
  try {
    const cacheKey = getCacheKey(key, userId);
    const item = localStorage.getItem(cacheKey);
    if (!item) return null;
    const entry = JSON.parse(item) as CacheEntry<T>;
    return entry.data ?? null;
  } catch (err) {
    console.error('[Cache] Get stale error:', err);
    return null;
  }
}

export function removeFromCache(key: string, userId: string): void {
  try {
    const cacheKey = getCacheKey(key, userId);
    localStorage.removeItem(cacheKey);
    console.log(`[Cache] Removed: ${key}`);
  } catch (err) {
    console.error('[Cache] Remove error:', err);
  }
}

export function clearUserCache(userId: string): void {
  try {
    const prefix = getCacheKey('', userId);
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    console.error('[Cache] Clear user error:', err);
  }
}

export function clearExpiredCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CACHE_PREFIX)) continue;
      try {
        const item = localStorage.getItem(key);
        if (!item) continue;
        const entry = JSON.parse(item) as CacheEntry<unknown>;
        if (isStale(entry)) {
          keysToRemove.push(key);
        }
      } catch {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    console.error('[Cache] Clear expired error:', err);
  }
}

export function clearAllCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log('[Cache] Cleared all cache');
  } catch (err) {
    console.error('[Cache] Clear all error:', err);
  }
}

export function getCacheStats(): { total: number; size: number; entries: Array<{ key: string; age: number }> } {
  const entries: Array<{ key: string; age: number }> = [];
  let totalSize = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    const item = localStorage.getItem(key);
    if (item) {
      totalSize += item.length;
      try {
        const entry = JSON.parse(item) as CacheEntry<unknown>;
        entries.push({
          key: key.replace(CACHE_PREFIX, ''),
          age: Date.now() - entry.timestamp,
        });
      } catch {
        entries.push({ key: key.replace(CACHE_PREFIX, ''), age: -1 });
      }
    }
  }
  return { total: entries.length, size: totalSize, entries };
}
