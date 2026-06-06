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

  constructor(
    private defaultMax: number = 60,
    private defaultWindowMs: number = 60_000,
  ) {}

  check(key: string, max?: number, windowMs?: number): RateLimitCheckResult {
    const now = Date.now();
    const effectiveMax = max ?? this.defaultMax;
    const effectiveWindow = windowMs ?? this.defaultWindowMs;

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

export const BYPASS_PREFIXES = ['/api/webhooks/', '/api/health', '/api/metrics', '/api/keepalive', '/api/cron'];

export function shouldBypassRateLimit(pathname: string): boolean {
  return BYPASS_PREFIXES.some(p => pathname.startsWith(p));
}
