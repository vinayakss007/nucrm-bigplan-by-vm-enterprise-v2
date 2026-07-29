import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js Edge Middleware
 *
 * Adds standard API headers to all /api/ responses:
 * - X-API-Version: current API version
 * - X-Request-Id: unique request identifier for tracing
 */

const API_VERSION = '2.0';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add API version + request ID to all API responses
  if (request.nextUrl.pathname.startsWith('/api/')) {
    response.headers.set('X-API-Version', API_VERSION);
    response.headers.set('X-Request-Id', crypto.randomUUID());
  }

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
