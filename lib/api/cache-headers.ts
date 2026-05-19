/**
 * API Response Cache Headers
 * Add to all API routes for browser caching
 */

export function setCacheHeaders(res: Response, options: {
  maxAge?: number;
  staleWhileRevalidate?: number;
  isPrivate?: boolean;
}): Response {
  const { maxAge = 60, staleWhileRevalidate = 300, isPrivate = true } = options;
  
  const headers = new Headers(res.headers);
  
  if (isPrivate) {
    // Private = user-specific data, only browser caches
    headers.set('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  } else {
    // Public = shared data, can be cached by CDN
    headers.set('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  }
  
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

// Common cache durations
export const CACHE = {
  // Short - frequently changing data
  SHORT: { maxAge: 30, staleWhileRevalidate: 60 },
  
  // Medium - moderately static data
  MEDIUM: { maxAge: 300, staleWhileRevalidate: 600 },
  
  // Long - static reference data
  LONG: { maxAge: 3600, staleWhileRevalidate: 7200 },
  
  // None - real-time or user-specific
  NONE: { maxAge: 0, staleWhileRevalidate: 0 },
};
