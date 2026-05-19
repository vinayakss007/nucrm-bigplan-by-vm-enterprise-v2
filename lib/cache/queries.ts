/**
 * Query Cache Module
 *
 * Caches database query results
 * Automatically handles cache invalidation
 */

import { cache } from './index';

const QUERY_PREFIX = 'query:';

/**
 * Cache a query result
 */
export async function cacheQuery<T = any>(
  key: string,
  data: T,
  ttlSeconds: number = 300
): Promise<void> {
  await cache.set(`${QUERY_PREFIX}${key}`, data, ttlSeconds);
}

/**
 * Get cached query result
 */
export async function getCachedQuery<T = any>(
  key: string
): Promise<T | null> {
  return cache.get(`${QUERY_PREFIX}${key}`);
}

/**
 * Get query result or execute fallback
 */
export async function getQueryOrFetch<T = any>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  return cache.getOrSet(`${QUERY_PREFIX}${key}`, fetchFn, ttlSeconds);
}

/**
 * Invalidate cached query
 */
export async function invalidateQuery(key: string): Promise<void> {
  await cache.del(`${QUERY_PREFIX}${key}`);
}

/**
 * Invalidate queries by tenant
 */
export async function invalidateTenantQueries(tenantId: string): Promise<void> {
  await cache.delByPattern(`query:${tenantId}:*`);
}

/**
 * Common query cache keys
 */
export const QueryKeys = {
  // Contacts
  contactsList: (tenantId: string, page: number, limit: number) =>
    `${tenantId}:contacts:list:${page}:${limit}`,

  contactsById: (tenantId: string, contactId: string) =>
    `${tenantId}:contacts:id:${contactId}`,

  // Deals
  dealsList: (tenantId: string, stage?: string) =>
    `${tenantId}:deals:list:${stage || 'all'}`,

  dealsById: (tenantId: string, dealId: string) =>
    `${tenantId}:deals:id:${dealId}`,

  // Companies
  companiesList: (tenantId: string) =>
    `${tenantId}:companies:list`,

  // Tasks
  tasksList: (tenantId: string, status?: string) =>
    `${tenantId}:tasks:list:${status || 'all'}`,

  // Dashboard stats
  dashboardStats: (tenantId: string) =>
    `${tenantId}:dashboard:stats`,

  // User permissions
  userPermissions: (userId: string, tenantId: string) =>
    `user:${userId}:tenant:${tenantId}:permissions`,

  // Tenant config
  tenantConfig: (tenantId: string) =>
    `tenant:${tenantId}:config`,
};

/**
 * Cache TTL presets
 */
export const CacheTTL = {
  short: 60,      // 1 minute - frequently changing data
  medium: 300,    // 5 minutes - standard queries
  long: 3600,     // 1 hour - rarely changing data
  veryLong: 86400, // 24 hours - rarely changing data
};

/**
 * Decorator for caching query results
 *
 * Usage:
 * @cachedQuery({
 *   key: (tenantId, page) => `contacts:${tenantId}:${page}`,
 *   ttl: 300
 * })
 * async function getContacts(tenantId: string, page: number) {
 *   // ... query logic
 * }
 */
export function cachedQuery<T extends any[], R = any>(options: {
  key: (...args: T) => string;
  ttl?: number;
}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: T) {
      const key = options.key(...args);
      const ttl = options.ttl || CacheTTL.medium;

      return getQueryOrFetch(
        key,
        () => originalMethod.apply(this, args),
        ttl
      );
    };

    return descriptor;
  };
}

/**
 * Invalidate cache after mutation
 *
 * Usage:
 * @invalidateCache(['contacts:list'])
 * async function createContact(data: ContactData) {
 *   // ... mutation logic
 * }
 */
export function invalidateCache(keys: string[] | ((...args: any[]) => string[])) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);

      const keysToInvalidate = typeof keys === 'function'
        ? keys(...args)
        : keys;

      for (const key of keysToInvalidate) {
        await invalidateQuery(key);
      }

      return result;
    };

    return descriptor;
  };
}
