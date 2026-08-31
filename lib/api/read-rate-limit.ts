/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * In-route rate limiting for read-only (GET) endpoints — defense in depth.
 *
 * The edge proxy (proxy.ts) already applies a global authenticated ceiling
 * (120 req/min per user, 300 for API keys, 30 for unauth). This adds a SECOND,
 * per-endpoint layer for a handful of GETs that run expensive full-dataset
 * aggregate queries (analytics/dashboard), so a single authenticated user
 * cannot exhaust database resources by hammering one costly report within their
 * global budget. It is intentionally more generous than the mutating limits —
 * reads are idempotent and lower-risk — but tight enough to blunt scraping.
 *
 * Usage in a GET handler (place immediately inside the try, before auth work):
 *   const limited = await rateLimitRead(request, 'analytics');
 *   if (limited) return limited;
 */
const READ_LIMITS: Record<string, number> = {
  // Expensive aggregate/report reads — full-dataset scans per call.
  analytics: 60,
};

const DEFAULT_READ_LIMIT = 120;

/**
 * Apply read rate limiting to a GET route handler.
 * Returns null if allowed, or a NextResponse 429 if rate limited.
 */
export async function rateLimitRead(
  request: Request,
  resource: string
): Promise<import('next/server').NextResponse | null> {
  const max = READ_LIMITS[resource] ?? DEFAULT_READ_LIMIT;
  const action = `${resource}_read`;
  return checkRateLimit(request, { action, max, windowMinutes: 1 });
}
