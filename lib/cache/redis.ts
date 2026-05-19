/**
 * Redis caching layer for API responses.
 * Falls back to in-memory cache if Redis is unavailable.
 */

const DEFAULT_TTL = 60; // seconds
const MEMORY_CACHE = new Map<string, { data: any; expires: number }>();
const MEMORY_MAX = 500;

let redisClient: any = null;

async function getRedis() {
  if (redisClient) return redisClient;
  try {
    const Redis = (await import('ioredis')).default;
    redisClient = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry, fall back to memory
      enableOfflineQueue: false,
    });
    await redisClient.connect().catch(() => { redisClient = null; });
  } catch {
    redisClient = null;
  }
  return redisClient;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = await getRedis();
  if (client) {
    try {
      const raw = await client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { /* fall through to memory */ }
  }

  // Memory fallback
  const entry = MEMORY_CACHE.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  MEMORY_CACHE.delete(key);
  return null;
}

export async function cacheSet(key: string, data: any, ttl = DEFAULT_TTL): Promise<void> {
  const client = await getRedis();
  if (client) {
    try {
      await client.set(key, JSON.stringify(data), 'EX', ttl);
      return;
    } catch { /* fall through to memory */ }
  }

  // Memory fallback
  if (MEMORY_CACHE.size >= MEMORY_MAX) {
    const oldest = MEMORY_CACHE.keys().next().value;
    if (oldest) MEMORY_CACHE.delete(oldest);
  }
  MEMORY_CACHE.set(key, { data, expires: Date.now() + ttl * 1000 });
}

export async function cacheDel(pattern: string): Promise<void> {
  const client = await getRedis();
  if (client) {
    try {
      const keys = await client.keys(pattern);
      if (keys.length) await client.del(...keys);
      return;
    } catch { /* fall through to memory */ }
  }

  // Memory fallback
  for (const key of MEMORY_CACHE.keys()) {
    if (key.includes(pattern.replace('*', ''))) MEMORY_CACHE.delete(key);
  }
}

/**
 * Higher-order function that wraps an async operation with caching.
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const data = await fetcher();
  await cacheSet(key, data, ttl);
  return data;
}
