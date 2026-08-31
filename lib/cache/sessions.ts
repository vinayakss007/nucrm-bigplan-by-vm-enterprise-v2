/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Session Cache Module
 *
 * Caches user sessions for fast lookup
 * TTL: 30 days (configurable)
 *
 * Uses a reverse index (user-sessions:<userId>) to track which tokens
 * belong to each user, enabling efficient per-user session invalidation
 * without expensive key-space scans.
 */

import { createHash } from 'crypto';
import { cache } from './index';

const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user-sessions:';
// Auth-context cache prefix, kept in sync with lib/tenant/request-context.ts.
// That cache stores the user's roleSlug + resolved permissions keyed by the
// SHA-256 token hash — the SAME hash this module uses for the session index
// (hashToken() in lib/auth/session.ts and tokenKey() below are both
// `sha256(token).hex`). So the per-user session index doubles as the index we
// need to clear a user's cached permissions. (#661)
const AUTH_CONTEXT_PREFIX = 'auth:context:';

/**
 * #1212: never store the raw JWT as a Redis key. If Redis is read by an
 * attacker, raw keys would be directly replayable session tokens. We key the
 * cache (and the per-user reverse index) by a SHA-256 hash of the token
 * instead. Callers keep passing the raw token; hashing is internal.
 */
function tokenKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Cache a session token and register it in the user's session index
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

  const hashed = tokenKey(token);
  await cache.set(`${SESSION_PREFIX}${hashed}`, sessionData, SESSION_TTL);

  // Register the hashed token in the user's session set for efficient
  // per-user deletion (the index must not hold raw tokens either).
  const indexKey = `${USER_SESSIONS_PREFIX}${userId}`;
  const existingTokens = await cache.get<string[]>(indexKey) ?? [];
  if (!existingTokens.includes(hashed)) {
    existingTokens.push(hashed);
    await cache.set(indexKey, existingTokens, SESSION_TTL);
  }
}

/**
 * Get session from cache
 */
export async function getSession(token: string): Promise<{
  userId: string;
  tenantId?: string;
  createdAt: number;
} | null> {
  return cache.get(`${SESSION_PREFIX}${tokenKey(token)}`);
}

/**
 * Delete a single session from cache and remove from user's session index
 */
export async function deleteSession(token: string): Promise<void> {
  const hashed = tokenKey(token);
  const sessionData = await getSession(token);
  await cache.del(`${SESSION_PREFIX}${hashed}`);

  // Remove from user's session index if we know the userId
  if (sessionData?.userId) {
    const indexKey = `${USER_SESSIONS_PREFIX}${sessionData.userId}`;
    const tokens = await cache.get<string[]>(indexKey) ?? [];
    const updated = tokens.filter(t => t !== hashed);
    if (updated.length > 0) {
      await cache.set(indexKey, updated, SESSION_TTL);
    } else {
      await cache.del(indexKey);
    }
  }
}

/**
 * Extend session TTL
 */
export async function refreshSession(token: string): Promise<void> {
  const session = await getSession(token);
  if (session) {
    await cache.set(`${SESSION_PREFIX}${tokenKey(token)}`, session, SESSION_TTL);
  }
}

/**
 * Check if session exists
 */
export async function sessionExists(token: string): Promise<boolean> {
  return cache.exists(`${SESSION_PREFIX}${tokenKey(token)}`);
}

/**
 * Delete all sessions for a user using the reverse index.
 * The index stores hashed tokens, so entries are already the cache keys.
 *
 * #661: also clears the auth-context cache (roleSlug + permissions) for each of
 * the user's tokens. Previously this cleared only the `session:` cache, so a
 * role/permission change could keep serving the OLD permissions from
 * `auth:context:` for up to its 5-minute TTL. Because both caches are keyed by
 * the same SHA-256 token hash, the session index gives us every context key to
 * bust, making role changes take effect on the very next request.
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  const indexKey = `${USER_SESSIONS_PREFIX}${userId}`;
  const hashedTokens = await cache.get<string[]>(indexKey) ?? [];

  // Delete each session key AND its matching auth-context (permissions) key.
  for (const hashed of hashedTokens) {
    await cache.del(`${SESSION_PREFIX}${hashed}`);
    await cache.del(`${AUTH_CONTEXT_PREFIX}${hashed}`);
  }

  // Delete the user's session index
  await cache.del(indexKey);
}

/**
 * Invalidate ONLY the cached auth context (roleSlug + permissions) for a user,
 * leaving their `session:` entries intact so they stay logged in. Use this on a
 * role/permission change where the goal is to force a fresh permission fetch on
 * the user's next request without signing them out. (#661)
 *
 * Keyed off the same per-user token index as the session cache, so it clears
 * every device/token the user has active.
 */
export async function invalidateUserContexts(userId: string): Promise<void> {
  const indexKey = `${USER_SESSIONS_PREFIX}${userId}`;
  const hashedTokens = await cache.get<string[]>(indexKey) ?? [];
  for (const hashed of hashedTokens) {
    await cache.del(`${AUTH_CONTEXT_PREFIX}${hashed}`);
  }
}

/**
 * Get session count (for monitoring)
 */
export async function getSessionCount(): Promise<number> {
  // Approximation — production should use Redis SCARD on a session set
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
  invalidateUserContexts,
  getSessionCount,
};
