/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import * as Sentry from "@sentry/nextjs";
import { DATA_COLLECTION } from './sentry-data-collection';
import { scrubPii } from './sentry-pii-scrub';

Sentry.init({
  dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'] ?? undefined,
  environment: process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development',
  ...(process.env['NEXT_PUBLIC_SENTRY_RELEASE'] ? { release: process.env['NEXT_PUBLIC_SENTRY_RELEASE'] } : {}),

  // This file, not `sentry.client.config.ts`, is what runs in the browser: a
  // Turbopack `next build` does not apply the webpack plugin that injects the
  // latter, and the deployed image proved it — `nucrm-app` (that file's
  // initialScope tag) and the scrubber's `[redacted-email]` marker appear in no
  // client chunk, while this file's `replaysSessionSampleRate` does. Anything
  // added to the other file only reaches customers if it also appears here.
  //
  // v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults are all
  // ON — omitting it collects cookies, headers, bodies and query params.
  dataCollection: DATA_COLLECTION,

  // GDPR: scrub PII from every event. `sentry-pii-scrub.ts` is platform-neutral,
  // so the browser now shares the server's one defence instead of sending raw.
  beforeSend(event) {
    return scrubPii(event);
  },

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