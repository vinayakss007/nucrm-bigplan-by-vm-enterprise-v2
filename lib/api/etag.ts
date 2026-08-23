/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * ETag & Conditional GET Support
 *
 * Adds ETag-based caching to API GET responses. When a client includes
 * `If-None-Match` header with the previous ETag, the server can return
 * 304 Not Modified without re-serializing the response body — saving
 * bandwidth and client parsing time.
 *
 * How it works:
 * 1. Handler builds the response data as usual
 * 2. `withETag()` hashes the JSON body to produce an ETag
 * 3. If `If-None-Match` matches the ETag → 304 (no body)
 * 4. Otherwise → full response with ETag header
 *
 * Usage:
 * ```ts
 * import { withETag } from '@/lib/api/etag';
 *
 * export async function GET(req: NextRequest) {
 *   const data = await fetchContacts(tenantId);
 *   return withETag(req, data);
 * }
 * ```
 *
 * ETag generation uses a fast non-cryptographic hash (FNV-1a) for
 * performance — ETags don't need collision resistance, just change detection.
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Generate a weak ETag from JSON-serializable data.
 * Uses FNV-1a hash on the stringified body — fast and sufficient for
 * change detection (not security).
 */
export function generateETag(data: unknown): string {
  const json = JSON.stringify(data);
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Weak ETag — content equivalence (not byte-for-byte identity)
  return `W/"${(hash >>> 0).toString(36)}"`;
}

/**
 * Return a JSON response with ETag support.
 *
 * If the client sends `If-None-Match` and it matches the computed ETag,
 * returns 304 Not Modified (empty body, saves bandwidth).
 *
 * @param req - The incoming request (to read If-None-Match)
 * @param data - The response payload (will be JSON.stringify'd)
 * @param options - Additional response options
 */
export function withETag(
  req: NextRequest,
  data: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): NextResponse {
  const { status = 200, headers = {} } = options;
  const etag = generateETag(data);
  const clientETag = req.headers.get('if-none-match');

  // Check if client already has the latest version
  if (clientETag && clientETag === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, ...headers },
    });
  }

  // Full response with ETag
  const response = NextResponse.json(data, { status });
  response.headers.set('ETag', etag);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

/**
 * Variant that accepts pre-computed data and a version/hash hint.
 * Useful when the data source already provides a version (e.g., updatedAt
 * timestamp) — avoids hashing the entire body.
 */
export function withVersionETag(
  req: NextRequest,
  data: unknown,
  version: string | number | Date,
  options: { status?: number; headers?: Record<string, string> } = {},
): NextResponse {
  const { status = 200, headers = {} } = options;
  const versionStr = version instanceof Date ? version.getTime().toString(36) : String(version);
  const etag = `W/"v-${versionStr}"`;
  const clientETag = req.headers.get('if-none-match');

  if (clientETag && clientETag === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, ...headers },
    });
  }

  const response = NextResponse.json(data, { status });
  response.headers.set('ETag', etag);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}
