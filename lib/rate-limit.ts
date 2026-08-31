/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Advanced Rate Limiting Module
 *
 * Features:
 * - Redis-backed rate limiting (multi-instance safe)
 * - Per-IP, per-user, per-tenant limits
 * - Sliding window algorithm with cleanup
 * - ALL limits configurable from Super Admin (zero hardcoded values)
 * - Per-plan rate limiting from database
 * - Super admin bypass for unlimited rate limits
 */

import { cache } from './cache/index';
import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/client-ip';
import { db } from '@/drizzle/db';
import { plans, users, systemSettings } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export interface RateLimitConfig {
  max: number;      // Max requests
  window: number;   // Time window in seconds
}

/**
 * Conservative limit applied when a limit LOOKUP fails (DB/cache error) so we
 * fail CLOSED instead of disabling rate limiting (#1834). This is deliberately
 * generous enough not to break legitimate traffic during a transient outage,
 * but low enough to blunt brute-force / scraping while the store is degraded.
 */
export const FAIL_CLOSED_DEFAULT = 60;

/**
 * Sentinel returned by getRateLimit() when the underlying lookup THREW, as
 * opposed to being intentionally configured to 0 (disabled). Callers must
 * treat this as "apply FAIL_CLOSED_DEFAULT", never as "unlimited".
 */
export const RATE_LIMIT_LOOKUP_ERROR = -1;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;    // Timestamp when limit resets
  limit: number;
}

// All endpoint keys - NO default values, everything from DB
export const RATE_LIMIT_ENDPOINTS = [
  { key: 'api', label: 'API Requests', window: 60, windowLabel: 'per minute' },
  { key: 'auth', label: 'Auth Requests', window: 60, windowLabel: 'per minute' },
  { key: 'contacts', label: 'Contacts CRUD', window: 60, windowLabel: 'per minute' },
  { key: 'deals', label: 'Deals CRUD', window: 60, windowLabel: 'per minute' },
  { key: 'export', label: 'Data Export', window: 3600, windowLabel: 'per hour' },
  { key: 'import', label: 'Data Import', window: 3600, windowLabel: 'per hour' },
  { key: 'ai', label: 'AI Features', window: 3600, windowLabel: 'per hour' },
  { key: 'webhook', label: 'Webhooks', window: 3600, windowLabel: 'per hour' },
  { key: 'passwordReset', label: 'Password Reset', window: 3600, windowLabel: 'per hour' },
  { key: 'emailVerification', label: 'Email Verification', window: 3600, windowLabel: 'per hour' },
  { key: 'bulk', label: 'Bulk Operations', window: 3600, windowLabel: 'per hour' },
];

/**
 * Get window seconds for an endpoint
 */
export function getEndpointWindow(endpoint: string): number {
  return RATE_LIMIT_ENDPOINTS.find(e => e.key === endpoint)?.window ?? 60;
}

/**
 * Get global default rate limits from system_settings table.
 * Throws on DB error so the caller can distinguish "lookup failed" from
 * "configured empty" and fail closed (#1834).
 */
export async function getGlobalDefaults(): Promise<Record<string, number>> {
  const setting = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, 'global_rate_limits'),
    columns: { value: true },
  });

  if (setting?.value) {
    return typeof setting.value === 'string'
      ? JSON.parse(setting.value)
      : (setting.value as Record<string, number>);
  }
  return {};
}

/**
 * Get rate limit for a specific endpoint.
 * Priority: Plan config > Global defaults > 0 (intentionally disabled).
 *
 * Returns RATE_LIMIT_LOOKUP_ERROR (-1) when the DB lookup THROWS — callers
 * must treat that as "apply FAIL_CLOSED_DEFAULT", NOT as unlimited (#1834).
 * A returned 0 means an admin intentionally disabled the endpoint.
 */
export async function getRateLimit(
  planId: string | null,
  endpoint: string
): Promise<number> {
  try {
    // 1. Try plan-specific config
    if (planId) {
      const plan = await db.query.plans.findFirst({
        where: eq(plans.id, planId),
        columns: { rateLimitConfig: true },
      });

      if (plan?.rateLimitConfig) {
        const config = plan.rateLimitConfig as Record<string, number>;
        if (config[endpoint] !== undefined) {
          return config[endpoint];
        }
      }
    }

    // 2. Try global defaults
    const globals = await getGlobalDefaults();
    if (globals[endpoint] !== undefined) {
      return globals[endpoint];
    }

    // 3. Nothing configured → 0 (rate limiting intentionally disabled)
    return 0;
  } catch (err) {
    // DB/cache failure: DO NOT disable rate limiting. Signal the error so
    // callers fall back to FAIL_CLOSED_DEFAULT (#1834).
    console.error('[rate-limit] getRateLimit lookup failed — failing closed:', err);
    return RATE_LIMIT_LOOKUP_ERROR;
  }
}

/**
 * Check if user has unlimited rate limit (super admin)
 */
export async function hasUnlimitedRateLimit(userId: string): Promise<boolean> {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { unlimitedRateLimit: true, isSuperAdmin: true },
    });

    return user?.unlimitedRateLimit === true || user?.isSuperAdmin === true;
  } catch (err) {
    // Fail closed: if we can't verify, treat as non-unlimited (#1834).
    console.error('[rate-limit] hasUnlimitedRateLimit lookup failed:', err);
    return false;
  }
}

/**
 * In-process fallback counter used ONLY when the shared cache store returns a
 * non-positive count (Redis down / cache.incr() swallowed an error and
 * returned 0). Without this, `0 <= max` would evaluate to allowed=true and the
 * limiter would fail OPEN on every request during a Redis outage (#1834).
 *
 * This is per-instance (not multi-instance safe), which is acceptable as a
 * degraded fail-closed fallback: it still caps abuse per node while the shared
 * store recovers.
 */
const fallbackCounters = new Map<string, { count: number; resetAt: number }>();

function fallbackIncr(key: string, windowSeconds: number): number {
  const now = Date.now();
  const entry = fallbackCounters.get(key);
  if (!entry || entry.resetAt <= now) {
    fallbackCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    // Opportunistic cleanup to bound memory.
    if (fallbackCounters.size > 10_000) {
      for (const [k, v] of fallbackCounters) {
        if (v.resetAt <= now) fallbackCounters.delete(k);
      }
    }
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

/**
 * Sliding window rate limiter
 */
export class RateLimiter {
  private defaultConfig: RateLimitConfig;

  constructor(defaultConfig: RateLimitConfig = { max: 100, window: 60 }) {
    this.defaultConfig = defaultConfig;
  }

  /**
   * Check rate limit for a key using sliding window
   */
  async check(
    key: string,
    maxOrConfig?: Partial<RateLimitConfig> | number,
    window?: number
  ): Promise<RateLimitResult> {
    let max: number;
    let win: number;
    if (typeof maxOrConfig === 'number') {
      max = maxOrConfig;
      win = window ?? this.defaultConfig.window;
    } else {
      const merged = { ...this.defaultConfig, ...maxOrConfig };
      max = merged.max;
      win = merged.window;
    }
    const now = Date.now();

    const windowKey = `rate:${key}`;

    // Add current request with timestamp
    let current = await cache.incr(windowKey, win);

    // #1834: cache.incr() returns 0 when the Redis store errored (it swallows
    // the exception). A raw 0 would make `0 <= max` always allow → fail OPEN.
    // Detect the degraded store and fail CLOSED via an in-process counter so a
    // Redis outage still enforces a per-instance ceiling.
    if (current <= 0) {
      current = fallbackIncr(windowKey, win);
    }

    const result: RateLimitResult = {
      allowed: current <= max,
      remaining: Math.max(0, max - current),
      reset: now + (win * 1000),
      limit: max,
    };

    return result;
  }

  /**
   * Check rate limit and throw if exceeded
   */
  async enforce(
    key: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    const result = await this.check(key, config);

    if (!result.allowed) {
      throw new RateLimitError(result);
    }

    return result;
  }

  /**
   * Get rate limit status without incrementing
   */
  async getStatus(
    key: string,
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    const { max } = { ...this.defaultConfig, ...config };

    const windowKey = `rate:${key}`;
    const currentCount = (await cache.get(windowKey)) as number || 0;

    return {
      allowed: currentCount <= max,
      remaining: Math.max(0, max - currentCount),
      reset: Date.now() + (this.defaultConfig.window * 1000),
      limit: max,
    };
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key: string): Promise<void> {
    const windowKey = `rate:${key}`;
    await cache.del(windowKey);
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends Error {
  public result: RateLimitResult;
  constructor(resultOrLimit: RateLimitResult | number) {
    if (typeof resultOrLimit === 'number') {
      const limit = resultOrLimit;
      const reset = Date.now() + 60000;
      const result: RateLimitResult = { allowed: false, remaining: 0, reset, limit };
      super(`Rate limit exceeded. Try again in 60s`);
      this.result = result;
    } else {
      super(`Rate limit exceeded. Try again in ${Math.ceil((resultOrLimit.reset - Date.now()) / 1000)}s`);
      this.result = resultOrLimit;
    }
    this.name = 'RateLimitError';
  }
}

/**
 * Get rate limit headers for response
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.reset / 1000).toString(),
    'Retry-After': result.allowed ? '0' : Math.ceil((result.reset - Date.now()) / 1000).toString(),
  };
}

/**
 * Check rate limit with plan-based limits and super admin bypass
 * Fetches ALL limits from database - nothing hardcoded
 */
export async function checkPlanRateLimit(
  userId: string,
  planId: string | null,
  endpoint: string,
  keyPrefix: string = 'api'
): Promise<{ result: RateLimitResult; bypassed: boolean } | null> {
  // Check if user has unlimited rate limit
  const isUnlimited = await hasUnlimitedRateLimit(userId);
  if (isUnlimited) {
    return {
      result: { allowed: true, remaining: 999999, reset: Date.now() + 60000, limit: 999999 },
      bypassed: true,
    };
  }

  // Get limit from database (plan config > global defaults)
  const lookedUpMax = await getRateLimit(planId, endpoint);

  // Lookup FAILED (DB/cache error) → fail closed with a conservative limit,
  // never treat as unlimited (#1834).
  const maxRequests = lookedUpMax === RATE_LIMIT_LOOKUP_ERROR ? FAIL_CLOSED_DEFAULT : lookedUpMax;

  // A configured 0 means an admin intentionally disabled this endpoint.
  if (maxRequests === 0) {
    return {
      result: { allowed: true, remaining: 999999, reset: Date.now() + 60000, limit: 999999 },
      bypassed: true,
    };
  }

  // Get window from endpoint config
  const window = getEndpointWindow(endpoint);

  const key = `${keyPrefix}:${userId}:${endpoint}`;
  const limiter = new RateLimiter({ max: maxRequests, window });
  const result = await limiter.check(key);

  return { result, bypassed: false };
}

/**
 * Create rate limiter for an endpoint (fetches limit from DB)
 */
export async function createEndpointLimiter(endpoint: string): Promise<RateLimiter> {
  const max = await getRateLimit(null, endpoint);
  const window = getEndpointWindow(endpoint);
  return new RateLimiter({ max: max || 1, window });
}

/**
 * Rate limit middleware for Next.js API routes
 * Fetches limits from database
 */
export async function rateLimitMiddleware(
  request: Request,
  endpointOrLimiter: string | RateLimiter,
  keyPrefix: string = 'api'
): Promise<RateLimitResult | null> {
  // #1249: header values only honored when TRUST_PROXY=true (see getClientIp)
  const ip = getClientIp(request);
  const authHeader = request.headers.get('authorization');

  const identifier = authHeader ? `user:${authHeader.slice(0, 20)}` : `ip:${ip}`;
  const key = `${keyPrefix}:${identifier}`;

  // If a RateLimiter instance is passed directly (backward compat)
  if (endpointOrLimiter instanceof RateLimiter) {
    return endpointOrLimiter.check(key);
  }

  const endpoint = endpointOrLimiter;

  // Get limit from DB
  const lookedUp = await getRateLimit(null, endpoint);
  if (lookedUp === 0) return null; // Intentionally disabled by admin
  // Lookup error → fail closed with a conservative limit (#1834)
  const max = lookedUp === RATE_LIMIT_LOOKUP_ERROR ? FAIL_CLOSED_DEFAULT : lookedUp;

  const window = getEndpointWindow(endpoint);
  const limiter = new RateLimiter({ max, window });
  return limiter.check(key);
}

/**
 * Backward-compatible createLimiter factory
 */
export function createLimiter(config: { max?: number; window?: number; windowMs?: number } = {}): RateLimiter {
  const window = config.window ?? (config.windowMs ? Math.ceil(config.windowMs / 1000) : 60);
  const max = config.max ?? 100;
  return new RateLimiter({ max, window });
}

/**
 * Pre-configured limiters per endpoint (backward compat)
 */
export const limiters = {
  api: new RateLimiter({ max: 60, window: 60 }),
  auth: new RateLimiter({ max: 200, window: 60 }),
  export: new RateLimiter({ max: 10, window: 3600 }),
  import: new RateLimiter({ max: 10, window: 3600 }),
  ai: new RateLimiter({ max: 30, window: 3600 }),
  webhook: new RateLimiter({ max: 30, window: 3600 }),
  passwordReset: new RateLimiter({ max: 3, window: 3600 }),
  emailVerification: new RateLimiter({ max: 5, window: 3600 }),
  contacts: new RateLimiter({ max: 60, window: 60 }),
  deals: new RateLimiter({ max: 60, window: 60 }),
  bulk: new RateLimiter({ max: 10, window: 3600 }),
};

// Default export - dynamically created per request
export const rateLimiter = new RateLimiter({ max: 1, window: 60 });

export default rateLimiter;

/**
 * Backwards compatibility - old checkRateLimit function
 * Accepts max/windowMinutes but fetches from DB when available
 */
export async function checkRateLimit(
  request: Request,
  options: { action?: string; max?: number; windowMinutes?: number } = {}
) {
  const { action = 'api', max: fallbackMax, windowMinutes: fallbackWindow } = options;

  // #1249: header values only honored when TRUST_PROXY=true (see getClientIp)
  const ip = getClientIp(request);
  const key = `v1_rate:${action}:${ip}`;

  // Get limit from DB first, fall back to provided max.
  // #1834: on lookup ERROR fail closed to the caller's fallback (or the
  // conservative default) — never leave the request effectively unlimited.
  const dbMax = await getRateLimit(null, action);
  const max = dbMax > 0
    ? dbMax
    : (fallbackMax || FAIL_CLOSED_DEFAULT);
  const window = fallbackWindow ? fallbackWindow * 60 : getEndpointWindow(action);
  const limiter = new RateLimiter({ max, window });
  const result = await limiter.check(key);

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: getRateLimitHeaders(result)
      }
    );
  }

  return null;
}
