/**
 * Cache Module Barrel Exports
 *
 * Redis-backed caching with in-memory fallback
 *
 * Usage:
 * import { cache } from '@/lib/cache'
 *
 * // Cache a value
 * await cache.set('key', 'value', 300) // 5 minutes
 *
 * // Get a value
 * const value = await cache.get('key')
 *
 * // Cache with fallback
 * const data = await cache.getOrSet('key', async () => {
 *   return expensiveOperation()
 * }, 300)
 */

import { Redis } from 'ioredis';

// Redis client singleton
let redis: Redis | null = null;

function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env['REDIS_URL'];

    if (!redisUrl) {
      // Fallback to in-memory cache if Redis not available
      console.warn('[Cache] Redis not configured, using in-memory cache');
      return null as any;
    }

    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 100, 3000);
      },
    });

    redis.on('error', (err) => {
      console.error('[Cache] Redis error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[Cache] Redis connected');
    });
  }

  return redis;
}

// In-memory fallback cache (for development)
// FIX HIGH-04: Add size limit to prevent unbounded memory growth
const MAX_CACHE_ENTRIES = 1000;
const memoryCache = new Map<string, { value: any; expires: number; lastAccessed: number }>();

function evictIfNecessary() {
  if (memoryCache.size <= MAX_CACHE_ENTRIES) return;
  
  // Evict oldest expired entries first
  const now = Date.now();
  for (const [key, item] of memoryCache.entries()) {
    if (now > item.expires) {
      memoryCache.delete(key);
      if (memoryCache.size <= MAX_CACHE_ENTRIES) return;
    }
  }
  
  // If still over limit, evict least recently used
  if (memoryCache.size > MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, item] of memoryCache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey) memoryCache.delete(oldestKey);
  }
}

/**
 * Set a cache value
 */
export async function set(
  key: string,
  value: any,
  ttlSeconds: number = 300
): Promise<void> {
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.setex(`nucrm:${key}`, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.error('[Cache] Set error:', error);
    }
  } else {
    // Fallback to memory cache
    evictIfNecessary();
    memoryCache.set(`nucrm:${key}`, {
      value,
      expires: Date.now() + (ttlSeconds * 1000),
      lastAccessed: Date.now(),
    });
  }
}

/**
 * Get a cache value
 */
export async function get<T = any>(key: string): Promise<T | null> {
  const redis = getRedisClient();

  if (redis) {
    try {
      const value = await redis.get(`nucrm:${key}`);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('[Cache] Get error:', error);
      return null;
    }
  } else {
    // Fallback to memory cache
    const item = memoryCache.get(`nucrm:${key}`);
    if (!item) return null;

    if (Date.now() > item.expires) {
      memoryCache.delete(`nucrm:${key}`);
      return null;
    }

    // Update last accessed time for LRU
    item.lastAccessed = Date.now();

    return item.value as T;
  }
}

/**
 * Get a value or set it with a fallback function
 */
export async function getOrSet<T = any>(
  key: string,
  fallback: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  const cached = await get<T>(key);
  if (cached !== null) return cached;

  const value = await fallback();
  await set(key, value, ttlSeconds);
  return value;
}

/**
 * Delete a cache value
 */
export async function del(key: string): Promise<void> {
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.del(`nucrm:${key}`);
    } catch (error) {
      console.error('[Cache] Delete error:', error);
    }
  } else {
    memoryCache.delete(`nucrm:${key}`);
  }
}

/**
 * Delete multiple keys by pattern
 */
export async function delByPattern(pattern: string): Promise<void> {
  const redis = getRedisClient();

  if (redis) {
    try {
      const keys = await redis.keys(`nucrm:${pattern}`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error('[Cache] Delete pattern error:', error);
    }
  } else {
    // Fallback: clear all memory cache
    memoryCache.clear();
  }
}

/**
 * Check if a key exists
 */
export async function exists(key: string): Promise<boolean> {
  const redis = getRedisClient();

  if (redis) {
    try {
      const result = await redis.exists(`nucrm:${key}`);
      return result === 1;
    } catch (error) {
      console.error('[Cache] Exists error:', error);
      return false;
    }
  } else {
    return memoryCache.has(`nucrm:${key}`);
  }
}

/**
 * Increment a counter
 */
export async function incr(key: string, ttlSeconds?: number): Promise<number> {
  const redis = getRedisClient();

  if (redis) {
    try {
      const result = await redis.incr(`nucrm:${key}`);
      if (ttlSeconds && result === 1) {
        await redis.expire(`nucrm:${key}`, ttlSeconds);
      }
      return result;
    } catch (error) {
      console.error('[Cache] Increment error:', error);
      return 0;
    }
  } else {
    // Fallback to memory cache
    const current = (await get(key)) || 0;
    const newValue = (current as number) + 1;
    await set(key, newValue, ttlSeconds || 300);
    return newValue;
  }
}

/**
 * Cache wrapper for database queries
 */
export async function cachedQuery<T = any>(
  key: string,
  queryFn: () => Promise<T>,
  ttlSeconds: number = 60
): Promise<T> {
  return getOrSet(`query:${key}`, queryFn, ttlSeconds);
}

/**
 * Session cache helpers
 */
export const session = {
  async set(token: string, userId: string, ttlSeconds: number = 2592000) { // 30 days
    await set(`session:${token}`, userId, ttlSeconds);
  },

  async get(token: string): Promise<string | null> {
    return get(`session:${token}`);
  },

  async delete(token: string): Promise<void> {
    await del(`session:${token}`);
  },
};

/**
 * Rate limit helpers
 */
export const rateLimit = {
  async check(
    key: string,
    max: number,
    windowSeconds: number = 60
  ): Promise<{ allowed: boolean; remaining: number; reset: number }> {
    const redis = getRedisClient();
    const windowKey = `rate:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

    if (redis) {
      try {
        const current = await redis.incr(windowKey);
        if (current === 1) {
          await redis.expire(windowKey, windowSeconds);
        }

        const ttl = await redis.ttl(windowKey);

        return {
          allowed: current <= max,
          remaining: Math.max(0, max - current),
          reset: Date.now() + (ttl * 1000),
        };
      } catch (error) {
        console.error('[Cache] Rate limit error:', error);
        return { allowed: true, remaining: max, reset: Date.now() };
      }
    } else {
      // Fallback to memory cache (not ideal for multi-instance)
      const current = await incr(windowKey, windowSeconds);
      return {
        allowed: current <= max,
        remaining: Math.max(0, max - current),
        reset: Date.now() + (windowSeconds * 1000),
      };
    }
  },
};

/**
 * Invalidate cache by tenant
 */
export async function invalidateTenantCache(tenantId: string): Promise<void> {
  await delByPattern(`tenant:${tenantId}:*`);
  await delByPattern(`query:${tenantId}:*`);
}

/**
 * Health check
 */
export async function health(): Promise<{ status: string; latency?: number }> {
  const redis = getRedisClient();

  if (!redis) {
    return { status: 'degraded', latency: 0 };
  }

  try {
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;

    return {
      status: latency < 10 ? 'healthy' : 'slow',
      latency,
    };
  } catch (error) {
    return { status: 'unhealthy', latency: 0 };
  }
}

// Export cache namespace
export const cache = {
  set,
  get,
  getOrSet,
  del,
  delByPattern,
  exists,
  incr,
  cachedQuery,
  session,
  rateLimit,
  invalidateTenantCache,
  health,
};

export default cache;

// Re-export query and session cache modules
export * from './queries';
export * from './sessions';
