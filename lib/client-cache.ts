const CACHE_PREFIX = 'nucrm_cache_';
const DEFAULT_TTL = 5 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheConfig {
  ttl?: number;
  skipCache?: boolean;
  forceRefresh?: boolean;
}

const store = new Map<string, CacheEntry<unknown>>();

function getKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

function isValid<T>(entry: CacheEntry<T>): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < entry.ttl;
}

export function getFromCache<T>(key: string): T | null {
  try {
    const entry = localStorage.getItem(getKey(key));
    if (!entry) return null;
    const parsed = JSON.parse(entry) as CacheEntry<T>;
    if (!isValid(parsed)) {
      localStorage.removeItem(getKey(key));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function setInCache<T>(key: string, data: T, config?: { ttl?: number }): void {
  try {
    const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl: config?.ttl ?? DEFAULT_TTL };
    localStorage.setItem(getKey(key), JSON.stringify(entry));
    console.log(`[Cache] Stored: ${key}`);
  } catch (err) {
    const isQuota = (err as Error)?.name === 'QuotaExceededError';
    if (isQuota) {
      if (typeof console.warn === 'function') console.warn('[Cache] Storage quota exceeded, clearing old entries...');
      clearExpired();
    } else {
      if (typeof console.error === 'function') console.error('[Cache] Set error:', err);
    }
  }
}

export function removeFromCache(key: string): void {
  try {
    localStorage.removeItem(getKey(key));
    console.log(`[Cache] Removed: ${key}`);
  } catch (err) {
    if (typeof console.error === 'function') console.error('[Cache] Remove error:', err);
  }
}

export function clearAll(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    console.log('[Cache] Cleared all cache');
  } catch (err) {
    if (typeof console.error === 'function') console.error('[Cache] Clear all error:', err);
  }
}

export function invalidateByPattern(pattern: string): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX) && k.includes(pattern)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch (err) {
    console.error('[Cache] Invalidate error:', err);
  }
}

export function getCacheStats(): { entries: number; enabled: boolean; size: number } {
  let entries = 0;
  let size = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) {
        entries++;
        const item = localStorage.getItem(k);
        if (item) size += item.length;
      }
    }
  } catch { /* ignore */ }
  return { entries, enabled: true, size };
}

export async function fetchWithCache<T>(key: string, fetcher: () => Promise<T>, options?: CacheConfig): Promise<T> {
  if (!options?.skipCache && !options?.forceRefresh) {
    const cached = getFromCache<T>(key);
    if (cached !== null) return cached;
  }
  const data = await fetcher();
  if (!options?.skipCache) setInCache(key, data);
  return data;
}

function clearExpired(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(CACHE_PREFIX)) continue;
      try {
        const item = localStorage.getItem(k);
        if (!item) continue;
        const entry = JSON.parse(item) as CacheEntry<unknown>;
        if (Date.now() - entry.timestamp >= entry.ttl) keys.push(k);
      } catch { keys.push(k); }
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

export const CacheKeys = {
  userProfile: (userId: string) => `user:${userId}:profile`,
  tenantInfo: (tenantId: string) => `tenant:${tenantId}:info`,
  contactsList: (tenantId: string, filters?: Record<string, unknown>) =>
    `tenant:${tenantId}:contacts:${JSON.stringify(filters ?? {})}`,
  dealsList: (tenantId: string, pipelineId?: string) =>
    `tenant:${tenantId}:deals:${pipelineId ?? 'all'}`,
  platformStats: () => 'superadmin:platform:stats',
  tenantSettings: (tenantId: string) => `tenant:${tenantId}:settings`,
  dashboardStats: (tenantId: string) => `tenant:${tenantId}:dashboard:stats`,
  orgSettings: (tenantId: string) => `org:${tenantId}:settings`,
  notifications: (userId: string) => `user:${userId}:notifications`,
};
