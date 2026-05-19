/**
 * Client-Side Cache for Fast Data Loading
 * 
 * Stores frequently accessed data in localStorage to avoid unnecessary API calls
 * - Automatic cache invalidation after TTL
 * - Stale-while-revalidate strategy
 * - Per-user data isolation
 */

const CACHE_PREFIX = 'nucrm_cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

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

/**
 * Generate cache key with user isolation
 */
function getCacheKey(key: string, userId?: string): string {
  return `${CACHE_PREFIX}${userId ? `${userId}_` : ''}${key}`;
}

/**
 * Check if cache entry is valid
 */
function isValid<T>(entry: CacheEntry<T>, userId: string): boolean {
  if (!entry) return false;
  if (entry.userId !== userId) return false; // User isolation
  
  const age = Date.now() - entry.timestamp;
  return age < entry.ttl;
}

/**
 * Check if cache entry is stale (but can be used while revalidating)
 */
function isStale<T>(entry: CacheEntry<T>): boolean {
  if (!entry) return true;
  const age = Date.now() - entry.timestamp;
  return age >= entry.ttl;
}

/**
 * Get data from cache
 * @returns null if not found or expired
 */
export function getFromCache<T>(key: string, userId: string): T | null {
  try {
    const cacheKey = getCacheKey(key, userId);
    const item = localStorage.getItem(cacheKey);
    
    if (!item) return null;
    
    const entry = JSON.parse(item) as CacheEntry<T>;
    
    if (!isValid(entry, userId)) {
      // Clean up expired cache
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    return entry.data;
  } catch (err) {
    console.error('[Cache] Get error:', err);
    return null;
  }
}

/**
 * Set data in cache
 */
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
    
    // Handle quota exceeded
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      console.warn('[Cache] Storage quota exceeded, clearing old entries...');
      clearExpiredCache();
    }
  }
}

/**
 * Get stale data while revalidating (SWR strategy)
 * @returns stale data even if expired, or null if not found
 */
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

/**
 * Remove item from cache
 */
export function removeFromCache(key: string, userId: string): void {
  try {
    const cacheKey = getCacheKey(key, userId);
    localStorage.removeItem(cacheKey);
    console.log(`[Cache] Removed: ${key}`);
  } catch (err) {
    console.error('[Cache] Remove error:', err);
  }
}

/**
 * Clear all cache for current user
 */
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
    console.log('[Cache] Cleared all user cache');
  } catch (err) {
    console.error('[Cache] Clear user error:', err);
  }
}

/**
 * Clear all expired cache entries
 */
export function clearExpiredCache(): void {
  try {
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CACHE_PREFIX)) continue;
      
      try {
        const item = localStorage.getItem(key);
        if (!item) continue;
        
        const entry = JSON.parse(item) as CacheEntry<any>;
        if (isStale(entry)) {
          keysToRemove.push(key);
        }
      } catch {
        // Invalid JSON, remove
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log(`[Cache] Cleared ${keysToRemove.length} expired entries`);
  } catch (err) {
    console.error('[Cache] Clear expired error:', err);
  }
}

/**
 * Clear all cache (admin function)
 */
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

/**
 * Get cache stats for debugging
 */
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
        const entry = JSON.parse(item) as CacheEntry<any>;
        entries.push({
          key: key.replace(CACHE_PREFIX, ''),
          age: Date.now() - entry.timestamp,
        });
      } catch {
        entries.push({ key: key.replace(CACHE_PREFIX, ''), age: -1 });
      }
    }
  }
  
  return {
    total: entries.length,
    size: totalSize,
    entries,
  };
}

/**
 * Run cleanup on startup (remove expired entries)
 */
if (typeof window !== 'undefined') {
  // Clean up expired cache on page load
  setTimeout(clearExpiredCache, 1000);
}
