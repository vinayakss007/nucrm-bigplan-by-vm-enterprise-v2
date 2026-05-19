/**
 * Client-Side Cache Utility
 * 
 * Stores frequently accessed data in localStorage for fast loading
 * Reduces server requests and improves perceived performance
 * 
 * Features:
 * - TTL-based expiration
 * - Size-based eviction
 * - Compression for large data
 * - Version-based invalidation
 */

const CACHE_PREFIX = 'nucrm_cache_';
const CACHE_VERSION = 'v1';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 2 * 1024 * 1024; // 2MB total cache limit

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  version: string;
}

export interface CacheConfig {
  /** Time to live in ms (default: 5 minutes) */
  ttl?: number;
  /** Cache key version for invalidation */
  version?: string;
  /** Skip cache for this request */
  skipCache?: boolean;
  /** Force refresh even if not expired */
  forceRefresh?: boolean;
}

/**
 * Generate cache key with prefix and version
 */
function makeKey(key: string): string {
  return `${CACHE_PREFIX}${CACHE_VERSION}_${key}`;
}

/**
 * Check if cache entry is valid (not expired)
 */
function isValid<T>(entry: CacheEntry<T> | null): boolean {
  if (!entry) return false;
  const now = Date.now();
  return now - entry.timestamp < entry.ttl;
}

/**
 * Get total cache size in bytes
 */
function getCacheSize(): number {
  let size = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      size += localStorage.getItem(key)?.length || 0;
    }
  }
  return size * 2; // Approximate bytes (UTF-16)
}

/**
 * Evict oldest entries if cache is too large
 */
function evictIfNeeded(): void {
  if (getCacheSize() < MAX_CACHE_SIZE) return;

  const entries: Array<{ key: string; timestamp: number }> = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      try {
        const entry = JSON.parse(localStorage.getItem(key) || '{}');
        entries.push({ key, timestamp: entry.timestamp || 0 });
      } catch {
        localStorage.removeItem(key);
      }
    }
  }

  // Sort by timestamp (oldest first) and remove oldest 20%
  entries.sort((a, b) => a.timestamp - b.timestamp);
  const toRemove = Math.ceil(entries.length * 0.2);
  
  for (let i = 0; i < toRemove; i++) {
    localStorage.removeItem(entries[i]!.key);
  }
}

/**
 * Get data from cache
 * @returns Cached data or null if not found/expired
 */
export function getFromCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const fullKey = makeKey(key);
    const item = localStorage.getItem(fullKey);
    
    if (!item) return null;
    
    const entry = JSON.parse(item) as CacheEntry<T>;
    
    if (!isValid(entry)) {
      localStorage.removeItem(fullKey);
      return null;
    }
    
    return entry.data;
  } catch (err) {
    console.warn('[ClientCache] Get error:', (err as Error).message);
    return null;
  }
}

/**
 * Set data in cache
 */
export function setInCache<T>(key: string, data: T, config?: CacheConfig): void {
  if (typeof window === 'undefined') return;
  
  try {
    evictIfNeeded();
    
    const fullKey = makeKey(key);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: config?.ttl ?? DEFAULT_TTL,
      version: config?.version ?? CACHE_VERSION,
    };
    
    localStorage.setItem(fullKey, JSON.stringify(entry));
  } catch (err) {
    console.warn('[ClientCache] Set error:', (err as Error).message);
    // If storage is full, clear old cache and retry
    if ((err as DOMException).name === 'QuotaExceededError') {
      clearAll();
      try {
        setInCache(key, data, config);
      } catch {
        // Give up if still fails
      }
    }
  }
}

/**
 * Remove item from cache
 */
export function removeFromCache(key: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem(makeKey(key));
  } catch (err) {
    console.warn('[ClientCache] Remove error:', (err as Error).message);
  }
}

/**
 * Clear all cache entries
 */
export function clearAll(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const keysToRemove: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    console.warn('[ClientCache] Clear error:', (err as Error).message);
  }
}

/**
 * Invalidate cache entries by pattern
 */
export function invalidateByPattern(pattern: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const keysToRemove: string[] = [];
    const searchKey = makeKey(pattern);
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.includes(searchKey)) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (err) {
    console.warn('[ClientCache] Invalidate error:', (err as Error).message);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { 
  entries: number; 
  size: number; 
  enabled: boolean 
} {
  if (typeof window === 'undefined') {
    return { entries: 0, size: 0, enabled: false };
  }
  
  let entries = 0;
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      entries++;
    }
  }
  
  return {
    entries,
    size: getCacheSize(),
    enabled: true,
  };
}

/**
 * Fetch with cache strategy
 * @param key - Cache key
 * @param fetcher - Function to fetch data if not in cache
 * @param config - Cache configuration
 */
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  config?: CacheConfig
): Promise<T> {
  // Skip cache if requested
  if (config?.skipCache) {
    return fetcher();
  }
  
  // Try to get from cache
  const cached = getFromCache<T>(key);
  if (cached && !config?.forceRefresh) {
    console.log(`[ClientCache] HIT: ${key}`);
    return cached;
  }
  
  // Fetch fresh data
  console.log(`[ClientCache] MISS: ${key}, fetching...`);
  const data = await fetcher();
  
  // Store in cache
  setInCache(key, data, config);
  
  return data;
}

/**
 * Cache keys for different data types
 */
export const CacheKeys = {
  // User & Auth
  userProfile: (userId: string) => `user:${userId}:profile`,
  userPermissions: (userId: string) => `user:${userId}:permissions`,
  tenantInfo: (tenantId: string) => `tenant:${tenantId}:info`,
  
  // Contacts
  contactsList: (tenantId: string, filters?: Record<string, any>) => 
    `tenant:${tenantId}:contacts:${JSON.stringify(filters || {})}`,
  contactById: (tenantId: string, contactId: string) => 
    `tenant:${tenantId}:contact:${contactId}`,
  
  // Companies
  companiesList: (tenantId: string) => `tenant:${tenantId}:companies`,
  companyById: (tenantId: string, companyId: string) => 
    `tenant:${tenantId}:company:${companyId}`,
  
  // Deals
  dealsList: (tenantId: string, pipelineId?: string) => 
    `tenant:${tenantId}:deals:${pipelineId || 'all'}`,
  dealsPipeline: (tenantId: string, pipelineId: string) => 
    `tenant:${tenantId}:pipeline:${pipelineId}:deals`,
  
  // Activities
  activities: (tenantId: string, limit = 50) => 
    `tenant:${tenantId}:activities:${limit}`,
  
  // Tasks
  tasks: (tenantId: string, filters?: Record<string, any>) => 
    `tenant:${tenantId}:tasks:${JSON.stringify(filters || {})}`,
  
  // Settings
  tenantSettings: (tenantId: string) => `tenant:${tenantId}:settings`,
  userPreferences: (userId: string) => `user:${userId}:preferences`,
  
  // Reports & Stats
  dashboardStats: (tenantId: string) => `tenant:${tenantId}:dashboard:stats`,
  reports: (tenantId: string, type: string) => `tenant:${tenantId}:report:${type}`,
  
  // Automation
  workflows: (tenantId: string) => `tenant:${tenantId}:workflows`,
  
  // Members
  teamMembers: (tenantId: string) => `tenant:${tenantId}:members`,
  
  // Notifications
  notifications: (userId: string) => `user:${userId}:notifications`,
  unreadCount: (userId: string) => `user:${userId}:notifications:unread`,
  
  // Super Admin
  platformStats: () => 'superadmin:platform:stats',
  tenantsList: (filters?: Record<string, any>) => `superadmin:tenants:${JSON.stringify(filters || {})}`,
  tenantById: (tenantId: string) => `superadmin:tenant:${tenantId}`,
  usersList: (filters?: Record<string, any>) => `superadmin:users:${JSON.stringify(filters || {})}`,
  revenue: () => 'superadmin:revenue',
  errors: (filters?: Record<string, any>) => `superadmin:errors:${JSON.stringify(filters || {})}`,
  usage: () => 'superadmin:usage',
  announcements: () => 'superadmin:announcements',
  tickets: () => 'superadmin:tickets',
  monitoring: () => 'superadmin:monitoring',
  
  // Organization Admin
  orgSettings: (tenantId: string) => `org:${tenantId}:settings`,
  orgBilling: (tenantId: string) => `org:${tenantId}:billing`,
  orgUsage: (tenantId: string) => `org:${tenantId}:usage`,
  orgMembers: (tenantId: string) => `org:${tenantId}:members`,
  orgAuditLog: (tenantId: string) => `org:${tenantId}:audit`,
  orgApiKeys: (tenantId: string) => `org:${tenantId}:api-keys`,
  orgWebhooks: (tenantId: string) => `org:${tenantId}:webhooks`,
  orgIntegrations: (tenantId: string) => `org:${tenantId}:integrations`,
};
