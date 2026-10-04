/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Sentry configuration for the browser client.
//
// NOT the live browser entry under our build. `next build` runs Turbopack, which
// does not apply the webpack plugin that injects this file, and the deployed
// image showed the result: neither this file's `nucrm-app` initialScope tag nor
// the scrubber's `[redacted-email]` marker is present in any client chunk. The
// browser initialises from `instrumentation-client.ts` — keep both in sync, and
// never treat a change here as shipped until it also appears there.
// @sentry/nextjs warns if both call `Sentry.init()` on the client.

import * as Sentry from '@sentry/nextjs';
import { DATA_COLLECTION } from './sentry-data-collection';
import { scrubPii } from './sentry-pii-scrub';

const SENTRY_DSN = process.env['SENTRY_DSN'];

const SENTRY_ENVIRONMENT = process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';
const SENTRY_RELEASE = process.env['NEXT_PUBLIC_SENTRY_RELEASE'] || undefined;

export const sentryConfig = {
  dsn: SENTRY_DSN || '',
  environment: SENTRY_ENVIRONMENT,
  ...(SENTRY_RELEASE ? { release: SENTRY_RELEASE } : {}),

  // v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults are all
  // ON — omitting it collects cookies, headers, bodies and query params. Stated
  // in full; see sentry-data-collection.ts.
  dataCollection: DATA_COLLECTION,

  // Initialize whenever a DSN is configured; explicit opt-out is SENTRY_DISABLE=true
  enabled: process.env['SENTRY_DISABLE'] !== 'true',
  
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
  
  // GDPR: scrub PII from every event
  beforeSend(event: Parameters<typeof scrubPii>[0]) {
    return scrubPii(event);
  },

  // Only track meaningful requests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
