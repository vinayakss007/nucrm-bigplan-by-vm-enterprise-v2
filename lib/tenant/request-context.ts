/**
 * Request Context Cache
 *
 * Caches authentication and tenant context per request to avoid
 * redundant database queries. Uses AsyncLocalStorage for request-scoped
 * caching without passing context through every function call.
 *
 * Usage:
 * ```ts
 * // In middleware or API route
 * import { requestContext } from '@/lib/tenant/request-context';
 *
 * const ctx = await requestContext.getOrFetch(request, async () => {
 *   return requireAuth(request);
 * });
 * ```
 */

import { AsyncLocalStorage } from 'async_hooks';
import { NextRequest } from 'next/server';
import { cache as redisCache } from '@/lib/cache/index';

export interface RequestContext {
  userId: string;
  tenantId: string;
  roleSlug: string;
  permissions: Record<string, boolean>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  authMethod?: 'jwt' | 'api_key';
  cachedAt: number;
}

// Request-scoped storage using AsyncLocalStorage
const asyncLocalStorage = new AsyncLocalStorage<Map<string, RequestContext>>();

// Global cache for cross-request caching (5 minute TTL)
const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'auth:context:';

/**
 * Get request-scoped context store
 */
function getStore(): Map<string, RequestContext> | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Get auth context from request-scoped cache
 */
export function getContext(requestId: string): RequestContext | undefined {
  const store = getStore();
  return store?.get(requestId);
}

/**
 * Set auth context in request-scoped cache
 */
export function setContext(requestId: string, ctx: RequestContext): void {
  const store = getStore();
  if (store) {
    store.set(requestId, ctx);
  }
}

/**
 * Get auth context from global cache (cross-request)
 */
export async function getCachedContext(tokenHash: string): Promise<RequestContext | null> {
  return redisCache.get(`${CACHE_PREFIX}${tokenHash}`);
}

/**
 * Set auth context in global cache
 */
export async function cacheContext(tokenHash: string, ctx: RequestContext): Promise<void> {
  await redisCache.set(`${CACHE_PREFIX}${tokenHash}`, ctx, CACHE_TTL);
}

/**
 * Invalidate cached context (e.g., on logout, permission change)
 */
export async function invalidateContext(tokenHash: string): Promise<void> {
  await redisCache.del(`${CACHE_PREFIX}${tokenHash}`);
}

/**
 * Run function with request-scoped context
 */
export function withRequestContext<T>(fn: () => T): T {
  const store = new Map<string, RequestContext>();
  return asyncLocalStorage.run(store, fn);
}

/**
 * Get or fetch auth context with caching
 *
 * 1. Check request-scoped cache (fastest)
 * 2. Check global cache (fast)
 * 3. Fetch from database (slow) and cache result
 */
export async function getOrFetchContext(
  requestId: string,
  tokenHash: string,
  fetchFn: () => Promise<RequestContext>
): Promise<RequestContext> {
  // 1. Check request-scoped cache
  const requestCached = getContext(requestId);
  if (requestCached) {
    return requestCached;
  }

  // 2. Check global cache
  const globalCached = await getCachedContext(tokenHash);
  if (globalCached) {
    // Also store in request-scoped cache
    setContext(requestId, globalCached);
    return globalCached;
  }

  // 3. Fetch from database
  const ctx = await fetchFn();

  // Cache in both request-scoped and global cache
  setContext(requestId, ctx);
  await cacheContext(tokenHash, ctx);

  return ctx;
}

/**
 * Generate a unique request ID for this execution context
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Batch get multiple contexts (for N+1 query optimization)
 */
export async function batchGetContexts(
  tokenHashes: string[]
): Promise<Map<string, RequestContext>> {
  const results = new Map<string, RequestContext>();

  // Get all from cache at once
  const cachePromises = tokenHashes.map(hash =>
    redisCache.get(`${CACHE_PREFIX}${hash}`).then(ctx => ({ hash, ctx }))
  );

  const cached = await Promise.all(cachePromises);

  for (const { hash, ctx } of cached) {
    if (ctx) {
      results.set(hash, ctx);
    }
  }

  return results;
}

export const requestContext = {
  get: getContext,
  set: setContext,
  getCached: getCachedContext,
  cache: cacheContext,
  invalidate: invalidateContext,
  with: withRequestContext,
  getOrFetch: getOrFetchContext,
  generateId: generateRequestId,
  batchGet: batchGetContexts,
};

export default requestContext;
