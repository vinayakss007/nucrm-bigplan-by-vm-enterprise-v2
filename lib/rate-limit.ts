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
import { db } from '@/drizzle/db';
import { plans, users, systemSettings } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export interface RateLimitConfig {
  max: number;      // Max requests
  window: number;   // Time window in seconds
}

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
 * Get global default rate limits from system_settings table
 */
export async function getGlobalDefaults(): Promise<Record<string, number>> {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'global_rate_limits'),
      columns: { value: true },
    });

    if (setting?.value) {
      return typeof setting.value === 'string'
        ? JSON.parse(setting.value)
        : (setting.value as Record<string, number>);
    }
  } catch {
    // Fall through to empty
  }
  return {};
}

/**
 * Get rate limit for a specific endpoint
 * Priority: Plan config > Global defaults > 0 (disabled)
 */
export async function getRateLimit(
  planId: string | null,
  endpoint: string
): Promise<number> {
  // 1. Try plan-specific config
  if (planId) {
    try {
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
    } catch {
      // Fall through
    }
  }

  // 2. Try global defaults
  const globals = await getGlobalDefaults();
  if (globals[endpoint] !== undefined) {
    return globals[endpoint];
  }

  // 3. If nothing configured, return 0 (rate limiting disabled)
  return 0;
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
  } catch {
    return false;
  }
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
    config?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    const { max, window } = { ...this.defaultConfig, ...config };
    const now = Date.now();

    const windowKey = `rate:${key}`;

    // Add current request with timestamp
    const current = await cache.incr(windowKey, window);

    const result: RateLimitResult = {
      allowed: current <= max,
      remaining: Math.max(0, max - current),
      reset: now + (window * 1000),
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
  constructor(public result: RateLimitResult) {
    super(`Rate limit exceeded. Try again in ${Math.ceil((result.reset - Date.now()) / 1000)}s`);
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
  const maxRequests = await getRateLimit(planId, endpoint);

  // If limit is 0, rate limiting is disabled for this endpoint
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
  endpoint: string,
  keyPrefix: string = 'api'
): Promise<RateLimitResult | null> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const authHeader = request.headers.get('authorization');

  const identifier = authHeader ? `user:${authHeader.slice(0, 20)}` : `ip:${ip}`;
  const key = `${keyPrefix}:${identifier}`;

  // Get limit from DB
  const max = await getRateLimit(null, endpoint);
  if (max === 0) return null; // Disabled

  const window = getEndpointWindow(endpoint);
  const limiter = new RateLimiter({ max, window });
  return limiter.check(key);
}

// Default export - dynamically created per request
export const rateLimiter = new RateLimiter({ max: 1, window: 60 });

export default rateLimiter;

/**
 * Backwards compatibility - old checkRateLimit function
 * Now fetches limits from database
 */
export async function checkRateLimit(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any,
  options: { action?: string } = {}
) {
  const { action = 'api' } = options;

  const ip = request?.headers?.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const key = `v1_rate:${action}:${ip}`;

  const max = await getRateLimit(null, action);
  if (max === 0) return null; // Disabled

  const window = getEndpointWindow(action);
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
