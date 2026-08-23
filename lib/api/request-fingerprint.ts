/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Request Fingerprinting & Double-Submit Prevention
 *
 * Detects duplicate POST/PUT/PATCH requests that arrive within a short
 * window (default 5 seconds). This catches accidental double-clicks and
 * race conditions at the browser level WITHOUT requiring the client to
 * send an explicit Idempotency-Key header.
 *
 * How it differs from idempotency keys:
 * - Idempotency keys (lib/api/idempotency.ts): client-driven, 24h TTL,
 *   caches the full response. For retries across network failures.
 * - Request fingerprint (this module): server-driven, 5s window, rejects
 *   the duplicate with 409. For accidental double-submits.
 *
 * How it works:
 * 1. Compute a fingerprint from: method + path + userId + body hash
 * 2. Check if this fingerprint was seen in the last N seconds
 * 3. If yes → 409 Conflict (with Retry-After: 1)
 * 4. If no → store fingerprint, let the request through
 *
 * Storage: In-memory Map with TTL-based eviction (no Redis dependency).
 * For single-instance deployments this is sufficient; for multi-instance
 * the idempotency key module (Redis-backed) provides the distributed version.
 *
 * Usage:
 * ```ts
 * import { rejectDuplicate } from '@/lib/api/request-fingerprint';
 *
 * export async function POST(req: NextRequest) {
 *   const dup = rejectDuplicate(req, userId);
 *   if (dup) return dup;
 *   // ... normal handler ...
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';

/** In-memory store: fingerprint → timestamp */
const seen = new Map<string, number>();

/** Eviction interval (every 30 seconds, remove expired entries) */
let evictionTimer: ReturnType<typeof setInterval> | null = null;

const DEFAULT_WINDOW_MS = 5_000;
const MAX_ENTRIES = 10_000;

function ensureEviction(windowMs: number): void {
  if (evictionTimer) return;
  evictionTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of seen) {
      if (now - ts > windowMs * 2) {
        seen.delete(key);
      }
    }
    // Safety valve: if map grows too large, clear it
    if (seen.size > MAX_ENTRIES) {
      seen.clear();
    }
  }, 30_000);
  // Don't prevent process exit
  if (evictionTimer && 'unref' in evictionTimer) {
    evictionTimer.unref();
  }
}

/**
 * Compute a fast FNV-1a hash of a string.
 */
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export interface FingerprintOptions {
  /** Deduplication window in milliseconds (default: 5000) */
  windowMs?: number;
}

/**
 * Check if this request is a duplicate of a recent one.
 * Returns a 409 NextResponse if duplicate, or null if the request should proceed.
 *
 * @param req - The incoming request
 * @param userId - Scoped per-user to prevent cross-user false positives
 * @param bodyHash - Optional pre-computed hash of request body (avoids re-reading)
 * @param options - Configuration
 */
export function rejectDuplicate(
  req: NextRequest,
  userId: string,
  bodyHash?: string,
  options: FingerprintOptions = {},
): NextResponse | null {
  const { windowMs = DEFAULT_WINDOW_MS } = options;

  ensureEviction(windowMs);

  const method = req.method;
  const path = new URL(req.url).pathname;
  const hashPart = bodyHash || 'no-body';

  // Fingerprint = method + path + userId + body hash
  const fingerprint = fnv1a(`${method}:${path}:${userId}:${hashPart}`);

  const now = Date.now();
  const lastSeen = seen.get(fingerprint);

  if (lastSeen && now - lastSeen < windowMs) {
    return NextResponse.json(
      {
        error: 'Duplicate request detected. Please wait and retry.',
        code: 'DUPLICATE_REQUEST',
        retryAfter: Math.ceil((windowMs - (now - lastSeen)) / 1000),
      },
      {
        status: 409,
        headers: { 'Retry-After': '1' },
      },
    );
  }

  // Mark this fingerprint
  seen.set(fingerprint, now);
  return null;
}

/**
 * Clear all stored fingerprints (for testing).
 */
export function clearFingerprints(): void {
  seen.clear();
}

/**
 * Get current fingerprint store size (for monitoring).
 */
export function getFingerprintCount(): number {
  return seen.size;
}
