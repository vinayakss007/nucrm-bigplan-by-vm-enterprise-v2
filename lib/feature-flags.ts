/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Lightweight Feature Flags System
 *
 * Runtime feature flags stored in Redis for instant toggle without deploy.
 * Supports: boolean on/off, percentage rollout, tenant-ID targeting, user-ID targeting.
 *
 * Usage:
 * ```ts
 * import { isFeatureEnabled } from '@/lib/feature-flags';
 *
 * if (await isFeatureEnabled('new-dashboard', { tenantId, userId })) {
 *   // show new dashboard
 * }
 * ```
 *
 * Admin API: POST /api/system/feature-flags to toggle flags.
 * Flags are cached with 30s TTL to reduce Redis round-trips.
 */

export interface FeatureFlag {
  /** Unique flag key */
  key: string;
  /** Whether the flag is globally enabled */
  enabled: boolean;
  /** Percentage of users to roll out to (0-100). Only checked if enabled=true */
  rolloutPercentage?: number;
  /** Specific tenant IDs that always get this flag */
  targetTenants?: string[];
  /** Specific user IDs that always get this flag */
  targetUsers?: string[];
  /** Description for admin UI */
  description?: string;
  /** When the flag was last updated */
  updatedAt?: string;
}

// In-memory cache with TTL
const flagCache = new Map<string, { flag: FeatureFlag; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

// Default flags (fallback when Redis is unavailable)
const DEFAULT_FLAGS: Record<string, FeatureFlag> = {
  'realtime-notifications': { key: 'realtime-notifications', enabled: true, description: 'WebSocket realtime push notifications' },
  'ai-lead-scoring': { key: 'ai-lead-scoring', enabled: true, description: 'AI-powered lead scoring' },
  'new-pipeline-ui': { key: 'new-pipeline-ui', enabled: false, rolloutPercentage: 0, description: 'Redesigned pipeline management page' },
  'bulk-email-campaigns': { key: 'bulk-email-campaigns', enabled: false, description: 'Mass email campaign sending' },
  'advanced-forecasting': { key: 'advanced-forecasting', enabled: false, description: 'ML-based deal forecasting' },
};

/**
 * Get a feature flag from cache or Redis.
 */
async function getFlag(key: string): Promise<FeatureFlag | null> {
  // Check cache first
  const cached = flagCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.flag;
  }

  // Try Redis
  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();

    const raw = await redis.get(`ff:${key}`);
    await redis.quit();

    if (raw) {
      const flag = JSON.parse(raw) as FeatureFlag;
      flagCache.set(key, { flag, expiresAt: Date.now() + CACHE_TTL_MS });
      return flag;
    }
  } catch {
    // Redis unavailable — fall through to defaults
  }

  // Fallback to defaults
  const defaultFlag = DEFAULT_FLAGS[key];
  if (defaultFlag) {
    flagCache.set(key, { flag: defaultFlag, expiresAt: Date.now() + CACHE_TTL_MS });
    return defaultFlag;
  }

  return null;
}

/**
 * Check if a feature is enabled for the given context.
 */
export async function isFeatureEnabled(
  key: string,
  context?: { tenantId?: string; userId?: string }
): Promise<boolean> {
  const flag = await getFlag(key);
  if (!flag) return false;
  if (!flag.enabled) return false;

  // Tenant targeting: if specified, only enabled for those tenants
  if (flag.targetTenants?.length && context?.tenantId) {
    if (flag.targetTenants.includes(context.tenantId)) return true;
  }

  // User targeting: if specified, only enabled for those users
  if (flag.targetUsers?.length && context?.userId) {
    if (flag.targetUsers.includes(context.userId)) return true;
  }

  // If we have targeting rules but the user/tenant isn't in them, check rollout
  if (flag.targetTenants?.length || flag.targetUsers?.length) {
    // Has targeting but didn't match — use rollout percentage
    if (flag.rolloutPercentage === undefined || flag.rolloutPercentage >= 100) return true;
  }

  // Percentage rollout
  if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
    // Use a deterministic hash of userId or tenantId for consistent experience
    const seed = context?.userId || context?.tenantId || '';
    const hash = simpleHash(seed + key);
    return (hash % 100) < flag.rolloutPercentage;
  }

  return true; // enabled with no restrictions
}

/**
 * Set/update a feature flag in Redis.
 */
export async function setFeatureFlag(flag: FeatureFlag): Promise<void> {
  flag.updatedAt = new Date().toISOString();

  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.set(`ff:${flag.key}`, JSON.stringify(flag));
    await redis.quit();
  } catch {
    // Redis unavailable — flag only in memory
  }

  // Update cache immediately
  flagCache.set(flag.key, { flag, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Get all feature flags (for admin UI).
 */
export async function getAllFlags(): Promise<FeatureFlag[]> {
  const flags: FeatureFlag[] = [];

  try {
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await redis.connect();

    const keys = await redis.keys('ff:*');
    if (keys.length > 0) {
      const values = await redis.mget(...keys);
      for (const raw of values) {
        if (raw) flags.push(JSON.parse(raw) as FeatureFlag);
      }
    }
    await redis.quit();
  } catch {
    // Redis unavailable — return defaults
  }

  // Merge with defaults (defaults may not be in Redis yet)
  for (const [key, defaultFlag] of Object.entries(DEFAULT_FLAGS)) {
    if (!flags.find(f => f.key === key)) {
      flags.push(defaultFlag);
    }
  }

  return flags.sort((a, b) => a.key.localeCompare(b.key));
}

/** Simple deterministic hash for percentage rollout */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash);
}
