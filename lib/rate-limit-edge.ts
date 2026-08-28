/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Edge-compatible in-memory sliding window rate limiter
 *
 * Designed for Next.js Edge Middleware (proxy.ts).
 * Uses per-isolate in-memory state — effective limit is instances * configured_max.
 * Provides a first line of defense; per-route Redis-backed limits are the second layer.
 */

interface SlidingWindowEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remaining: number;
  reset: number;
  limit: number;
}

export class EdgeRateLimiter {
  private windows = new Map<string, SlidingWindowEntry>();
  // Timestamp of the last expired-entry sweep. Used to throttle sweeps so
  // check() stays O(1) on the hot path and only pays the O(n) sweep cost
  // occasionally (at most once per defaultWindowMs).
  private lastSweepAt = 0;

  constructor(
    private defaultMax: number = 60,
    private defaultWindowMs: number = 60_000,
  ) {}

  /**
   * Lazily evict entries whose window has fully expired.
   *
   * Runs at most once per `defaultWindowMs` to keep amortized cost low and
   * avoid a background timer (setInterval is inappropriate in edge/serverless
   * contexts and can keep the process alive). Only entries with
   * `resetAt <= now` are removed, so still-active windows are never dropped
   * and rate-limit semantics for active keys are preserved.
   */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.defaultWindowMs) {
      return;
    }
    this.lastSweepAt = now;
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }

  check(key: string, max?: number, windowMs?: number): RateLimitCheckResult {
    const now = Date.now();
    const effectiveMax = max ?? this.defaultMax;
    const effectiveWindow = windowMs ?? this.defaultWindowMs;

    // Opportunistically reclaim memory from keys that stopped recurring.
    this.sweep(now);

    const entry = this.windows.get(key);

    if (!entry || now > entry.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + effectiveWindow });
      return { allowed: true, remaining: effectiveMax - 1, reset: now + effectiveWindow, limit: effectiveMax };
    }

    entry.count++;

    return {
      allowed: entry.count <= effectiveMax,
      remaining: Math.max(0, effectiveMax - entry.count),
      reset: entry.resetAt,
      limit: effectiveMax,
    };
  }

  get size(): number {
    return this.windows.size;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  clear(): void {
    this.windows.clear();
  }
}

export function getRateLimitHeaders(result: RateLimitCheckResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.reset / 1000).toString(),
    'Retry-After': result.allowed ? '0' : Math.ceil((result.reset - Date.now()) / 1000).toString(),
  };
}

export const edgeLimiter = new EdgeRateLimiter();

export const BYPASS_PREFIXES = ['/api/webhooks/', '/api/health', '/api/metrics', '/api/keepalive', '/api/cron', '/api/tenant/dashboard/widgets/', '/api/flags', '/api/openapi', '/api/system/ready'];

export function shouldBypassRateLimit(pathname: string): boolean {
  return BYPASS_PREFIXES.some(p => pathname.startsWith(p));
}
