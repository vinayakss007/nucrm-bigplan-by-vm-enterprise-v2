// Sentry configuration for Next.js 16
// This file configures Sentry for both client and server-side error tracking

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env['SENTRY_DSN'];

export const sentryConfig = {
  dsn: SENTRY_DSN || '',
  
  // Enable in production and development to catch issues early
  enabled: process.env['SENTRY_ENABLE'] !== 'false',
  
  // Performance monitoring
  tracesSampleRate: process.env['SENTRY_TRACES_SAMPLE_RATE'] 
    ? parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE']) 
    : 0.2,
  
  // Session replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  
  // Filter out health check noise
  ignoreErrors: [
    // Browser extensions
    'chrome-extension://',
    'moz-extension://',
    // Network errors (too common, not useful)
    'Network Error',
    'Failed to fetch',
    'Load failed',
    // React development errors (shouldn't happen in prod)
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
  ],
  
  // Only track meaningful requests
  beforeSendTransaction(event: any) {
    // Ignore health check endpoints
    if (event.transaction === '/api/health') {
      return null;
    }
    return event;
  },
  
  // Custom tags for better filtering
  initialScope: {
    tags: {
      service: 'nucrm-app',
      version: process.env['npm_package_version'] || '1.0.0',
    },
  },
};

// Initialize Sentry
if (SENTRY_DSN) {
  Sentry.init(sentryConfig);
}

export { Sentry };
