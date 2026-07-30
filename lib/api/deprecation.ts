/**
 * API Deprecation & Sunset Headers
 *
 * Marks endpoints as deprecated and communicates sunset dates to API consumers
 * via standard HTTP headers. This gives clients advance warning before breaking
 * changes, following the IETF Sunset Header RFC (RFC 8594).
 *
 * Why:
 * - As NuCRM's API evolves, old endpoints must be retired safely
 * - Clients (mobile apps, integrations) need time to migrate
 * - Without warning headers, deprecations are silent and breaking
 *
 * How it works:
 * - Wrap your endpoint response with `withDeprecation(response, opts)`
 * - Clients receive `Deprecation: true`, `Sunset: <date>`, and `Link: <docs>`
 * - Monitoring/alerts can scan for requests to deprecated endpoints
 *
 * Headers set:
 * - Deprecation: true (or specific date)
 * - Sunset: <HTTP-date> (when the endpoint will be removed)
 * - Link: <url>; rel="successor-version" (where to migrate to)
 *
 * Usage:
 * ```ts
 * import { withDeprecation } from '@/lib/api/deprecation';
 *
 * export async function GET(req: NextRequest) {
 *   const data = await fetchV1Data();
 *   return withDeprecation(NextResponse.json(data), {
 *     sunset: new Date('2025-03-01'),
 *     successor: '/api/v2/contacts',
 *     message: 'Use GET /api/v2/contacts instead',
 *   });
 * }
 * ```
 */

import { NextResponse } from 'next/server';

export interface DeprecationOptions {
  /** When the endpoint was deprecated (default: now) */
  since?: Date;
  /** When the endpoint will stop working */
  sunset?: Date;
  /** URL of the successor endpoint or documentation */
  successor?: string;
  /** Human-readable deprecation message */
  message?: string;
}

export interface DeprecationInfo {
  path: string;
  method: string;
  since: string;
  sunset?: string;
  successor?: string;
  message?: string;
}

/**
 * Registry of deprecated endpoints (for monitoring/alerting).
 */
const registry = new Map<string, DeprecationInfo>();

/**
 * Add deprecation headers to an API response.
 *
 * @param response - The NextResponse to augment
 * @param options - Deprecation configuration
 * @returns The same response with added headers
 */
export function withDeprecation(
  response: NextResponse,
  options: DeprecationOptions = {},
): NextResponse {
  const { since, sunset, successor, message } = options;

  // Set Deprecation header (RFC draft)
  if (since) {
    response.headers.set('Deprecation', since.toUTCString());
  } else {
    response.headers.set('Deprecation', 'true');
  }

  // Set Sunset header (RFC 8594)
  if (sunset) {
    response.headers.set('Sunset', sunset.toUTCString());
  }

  // Set Link header to successor
  if (successor) {
    response.headers.set('Link', `<${successor}>; rel="successor-version"`);
  }

  // Custom warning message
  if (message) {
    response.headers.set('X-Deprecation-Notice', message);
  }

  return response;
}

/**
 * Register a deprecated endpoint (for dashboard/alerting purposes).
 */
export function registerDeprecation(info: DeprecationInfo): void {
  const key = `${info.method}:${info.path}`;
  registry.set(key, info);
}

/**
 * Get all registered deprecated endpoints.
 */
export function getDeprecatedEndpoints(): DeprecationInfo[] {
  return Array.from(registry.values());
}

/**
 * Check if a specific endpoint is registered as deprecated.
 */
export function isDeprecated(method: string, path: string): DeprecationInfo | null {
  return registry.get(`${method}:${path}`) ?? null;
}

/**
 * Clear the registry (for testing).
 */
export function clearDeprecationRegistry(): void {
  registry.clear();
}
