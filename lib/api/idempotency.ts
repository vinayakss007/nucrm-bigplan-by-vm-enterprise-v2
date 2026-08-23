/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Idempotency key support.
 *
 * Prevents duplicate resource creation when a client retries a POST due to
 * network timeout. The client sends `Idempotency-Key: <uuid>` in the header;
 * if we've already processed that key, we return the stored response instead
 * of executing the handler again.
 *
 * Storage: Redis with TTL (24 hours). If Redis is unavailable, the request
 * proceeds normally (degraded but not broken — prefer availability over
 * strictness for a convenience feature).
 *
 * Scope: per-tenant. The same key from different tenants creates two separate
 * records (a tenant cannot replay another tenant's key).
 *
 * Usage in a route:
 *   import { withIdempotency } from '@/lib/api/idempotency';
 *
 *   export async function POST(request: NextRequest) {
 *     return withIdempotency(request, tenantId, async () => {
 *       // ... your normal handler logic ...
 *       return NextResponse.json({ data: created }, { status: 201 });
 *     });
 *   }
 *
 * If the client doesn't send the header, the handler executes normally with
 * no caching — backward compatible.
 */

import { NextRequest, NextResponse } from 'next/server';
import { cache } from '@/lib/cache/index';

const IDEMPOTENCY_TTL = 86_400; // 24 hours
const HEADER_NAME = 'idempotency-key';

interface StoredResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

function cacheKey(tenantId: string, idempotencyKey: string): string {
  return `idempotency:${tenantId}:${idempotencyKey}`;
}

/**
 * Wrap a handler with idempotency support.
 *
 * If the client sends `Idempotency-Key` and we have a cached response for it,
 * returns the cached response immediately. Otherwise executes the handler and
 * caches the response for future replays.
 */
export async function withIdempotency(
  request: NextRequest,
  tenantId: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = request.headers.get(HEADER_NAME);

  // No idempotency key → execute normally
  if (!key || key.trim() === '') {
    return handler();
  }

  // Validate key format (should be a UUID or similar short string)
  if (key.length > 128) {
    return NextResponse.json(
      { error: 'Idempotency-Key must be 128 characters or fewer' },
      { status: 400 },
    );
  }

  const ck = cacheKey(tenantId, key);

  // Check if we already processed this key
  try {
    const cached = await cache.get<StoredResponse>(ck);
    if (cached) {
      // Replay the stored response
      const response = new NextResponse(cached.body, { status: cached.status });
      response.headers.set('X-Idempotency-Replayed', 'true');
      for (const [h, v] of Object.entries(cached.headers)) {
        response.headers.set(h, v);
      }
      return response;
    }
  } catch {
    // Redis unavailable — proceed without idempotency (graceful degradation)
  }

  // Execute the handler
  const response = await handler();

  // Only cache successful responses (2xx). Don't cache errors — the client
  // should be able to retry after fixing the request.
  if (response.status >= 200 && response.status < 300) {
    try {
      const body = await response.clone().text();
      const headers: Record<string, string> = {};
      response.headers.forEach((v, h) => {
        if (!h.startsWith('x-') && h !== 'set-cookie') {
          headers[h] = v;
        }
      });

      await cache.set(ck, { status: response.status, body, headers }, IDEMPOTENCY_TTL);
    } catch {
      // Cache write failed — response still goes to client, just won't replay
    }
  }

  return response;
}

/**
 * Check if a request carries an idempotency key.
 * Useful for logging/metrics without executing the full wrapper.
 */
export function hasIdempotencyKey(request: NextRequest): boolean {
  const key = request.headers.get(HEADER_NAME);
  return Boolean(key && key.trim() !== '');
}
