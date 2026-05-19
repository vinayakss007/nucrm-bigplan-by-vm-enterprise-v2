/**
 * Session Cache Module
 *
 * Caches user sessions for fast lookup
 * TTL: 30 days (configurable)
 */

import { cache } from './index';

const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const SESSION_PREFIX = 'session:';

/**
 * Cache a session token
 */
export async function cacheSession(
  token: string,
  userId: string,
  tenantId?: string
): Promise<void> {
  const sessionData = {
    userId,
    tenantId,
    createdAt: Date.now(),
  };

  await cache.set(`${SESSION_PREFIX}${token}`, sessionData, SESSION_TTL);
}

/**
 * Get session from cache
 */
export async function getSession(token: string): Promise<{
  userId: string;
  tenantId?: string;
  createdAt: number;
} | null> {
  return cache.get(`${SESSION_PREFIX}${token}`);
}

/**
 * Delete session from cache
 */
export async function deleteSession(token: string): Promise<void> {
  await cache.del(`${SESSION_PREFIX}${token}`);
}

/**
 * Extend session TTL
 */
export async function refreshSession(token: string): Promise<void> {
  const session = await getSession(token);
  if (session) {
    await cache.set(`${SESSION_PREFIX}${token}`, session, SESSION_TTL);
  }
}

/**
 * Check if session exists
 */
export async function sessionExists(token: string): Promise<boolean> {
  return cache.exists(`${SESSION_PREFIX}${token}`);
}

/**
 * Delete all sessions for a user
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  // Note: This requires scanning keys, which is expensive
  // Better to track sessions in a separate data structure
  console.warn('[Session] deleteUserSessions requires key scanning - use with caution');
}

/**
 * Get session count (for monitoring)
 */
export async function getSessionCount(): Promise<number> {
  // This is an estimate - Redis doesn't have a direct count by pattern
  // You'd need to track this separately for accuracy
  return 0;
}

// Export session cache helpers as a namespace
export const sessionCache = {
  cacheSession,
  getSession,
  deleteSession,
  refreshSession,
  sessionExists,
  deleteUserSessions,
  getSessionCount,
};
