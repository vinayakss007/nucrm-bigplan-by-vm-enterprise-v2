/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? undefined,
  environment: process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development',
  ...(process.env['NEXT_PUBLIC_SENTRY_RELEASE'] ? { release: process.env['NEXT_PUBLIC_SENTRY_RELEASE'] } : {}),

  // v11 removed `sendDefaultPii`; the SDK now treats anything other than an
  // explicit `dataCollection` opt-in as off, so PII is still never sent.

  // 100% in dev, 10% in production
  tracesSampleRate: process.env['NODE_ENV'] === "development" ? 1.0 : 0.1,

  // Session Replay: 10% of all sessions, 100% of sessions with errors
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Filter out noise
  ignoreErrors: [
    'chrome-extension://',
    'moz-extension://',
    'Network Error',
    'Failed to fetch',
    'Load failed',
    'ResizeObserver loop',
  ],
});

// Hook into App Router navigation transitions
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;