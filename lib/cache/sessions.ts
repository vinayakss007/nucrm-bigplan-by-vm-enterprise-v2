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

import { cache } from './index';

const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user-sessions:';

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

  await cache.set(`${SESSION_PREFIX}${token}`, sessionData, SESSION_TTL);

  // Register token in user's session set for efficient per-user deletion
  const indexKey = `${USER_SESSIONS_PREFIX}${userId}`;
  const existingTokens = await cache.get<string[]>(indexKey) ?? [];
  if (!existingTokens.includes(token)) {
    existingTokens.push(token);
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
  return cache.get(`${SESSION_PREFIX}${token}`);
}

/**
 * Delete a single session from cache and remove from user's session index
 */
export async function deleteSession(token: string): Promise<void> {
  const sessionData = await getSession(token);
  await cache.del(`${SESSION_PREFIX}${token}`);

  // Remove from user's session index if we know the userId
  if (sessionData?.userId) {
    const indexKey = `${USER_SESSIONS_PREFIX}${sessionData.userId}`;
    const tokens = await cache.get<string[]>(indexKey) ?? [];
    const updated = tokens.filter(t => t !== token);
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
 * Delete all sessions for a user using the reverse index
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  const indexKey = `${USER_SESSIONS_PREFIX}${userId}`;
  const tokens = await cache.get<string[]>(indexKey) ?? [];

  // Delete each session key
  for (const token of tokens) {
    await cache.del(`${SESSION_PREFIX}${token}`);
  }

  // Delete the user's session index
  await cache.del(indexKey);
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
  getSessionCount,
};
