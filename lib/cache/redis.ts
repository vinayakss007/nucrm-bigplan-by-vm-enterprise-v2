/**
 * Redis caching layer for API responses.
 * 
 * FIXED: Reuses the Redis connection from lib/cache/index.ts
 * instead of creating a duplicate connection.
 * Falls back to in-memory cache if Redis is unavailable.
 */

import { cache } from './index';

const DEFAULT_TTL = 60; // seconds

/**
 * Get a cached value by key
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  return cache.get<T>(key);
}

/**
 * Set a cached value with TTL
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cacheSet(key: string, data: any, ttl = DEFAULT_TTL): Promise<void> {
  await cache.set(key, data, ttl);
}

/**
 * Delete cache entries by pattern
 */
export async function cacheDel(pattern: string): Promise<void> {
  await cache.delByPattern(pattern);
}

/**
 * Higher-order function that wraps an async operation with caching.
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL
): Promise<T> {
  return cache.getOrSet<T>(key, fetcher, ttl);
}
