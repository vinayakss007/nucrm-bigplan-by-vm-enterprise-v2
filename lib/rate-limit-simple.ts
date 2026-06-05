/**
 * Simple In-Memory Rate Limiter for Public Endpoints
 *
 * Provides IP-based rate limiting without external dependencies (no Redis required).
 * Suitable for single-instance deployments. For multi-instance, use the Redis-backed
 * rate limiter in lib/rate-limit.ts instead.
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 60 seconds to prevent memory growth
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanupExpired(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}

/**
 * Check rate limit for a given IP.
 * Returns null if allowed, or a 429 NextResponse if rate limited.
 *
 * @param req - The incoming request
 * @param opts - Configuration options
 * @param opts.max - Maximum requests per window (default: 100)
 * @param opts.windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @param opts.prefix - Key prefix to isolate different endpoints
 */
export function checkPublicRateLimit(
  req: NextRequest,
  opts: { max?: number; windowMs?: number; prefix?: string } = {}
): NextResponse | null {
  const { max = 100, windowMs = 60_000, prefix = 'public' } = opts;

  cleanupExpired();

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';

  const key = `${prefix}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // Start a new window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count += 1;

  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
        },
      }
    );
  }

  return null;
}
