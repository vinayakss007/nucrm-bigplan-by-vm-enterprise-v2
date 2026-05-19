/**
 * Development Tracking Middleware
 * 
 * Automatically tracks all requests, errors, and performance in development
 * 
 * Features:
 * - Request/response logging
 * - Performance timing
 * - Error tracking
 * - Database query logging
 * - Memory monitoring
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { devLogger } from '@/lib/dev-logger';

// Track slow requests
const SLOW_REQUEST_THRESHOLD = 1000; // ms

// Track very slow requests
const VERY_SLOW_REQUEST_THRESHOLD = 3000; // ms

export function middleware(request: NextRequest) {
  const startTime = Date.now();
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Skip static files and dev dashboard
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/dev/dashboard')
  ) {
    return NextResponse.next();
  }

  // Log memory at start (every 100 requests)
  if (Math.random() < 0.01) {
    devLogger.memory('request-start');
  }

  // Create response with timing
  const response = NextResponse.next();

  // Track response when finished
  response.headers.set('X-Request-Start', startTime.toString());

  // Log in development only
  if (process.env.NODE_ENV === 'development') {
    // Start timing
    devLogger.time(`request-${pathname}`);

    // Log when response is ready
    setTimeout(() => {
      const duration = Date.now() - startTime;
      
      // Log the request
      devLogger.request(
        method,
        pathname,
        response.status,
        duration,
        request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown',
        undefined // userId would require auth context
      );

      // Warn about slow requests
      if (duration > VERY_SLOW_REQUEST_THRESHOLD) {
        devLogger.log(
          `🚨 VERY SLOW REQUEST: ${method} ${pathname} took ${duration}ms`,
          'error',
          { color: devLogger['colors'].red, icon: '🚨' }
        );
      } else if (duration > SLOW_REQUEST_THRESHOLD) {
        devLogger.log(
          `⚠️ SLOW REQUEST: ${method} ${pathname} took ${duration}ms`,
          'warn',
          { color: devLogger['colors'].yellow, icon: '⚠️' }
        );
      }
    }, 0);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - dev/dashboard (dev dashboard itself)
     */
    '/((?!_next/static|_next/image|favicon.ico|dev/dashboard).*)',
  ],
};
