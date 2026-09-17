/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Sentry Edge config (for middleware, etc.)
import * as Sentry from '@sentry/nextjs';
import { scrubPii } from './sentry-pii-scrub';

const SENTRY_DSN = process.env['SENTRY_DSN'];

const SENTRY_ENVIRONMENT = process.env['SENTRY_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';
const SENTRY_RELEASE =
  process.env['SENTRY_RELEASE'] || process.env['NEXT_PUBLIC_SENTRY_RELEASE'] || undefined;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    ...(SENTRY_RELEASE ? { release: SENTRY_RELEASE } : {}),

    // GDPR: never send PII by default
    sendDefaultPii: false,

    // Initialize whenever a DSN is configured; explicit opt-out is SENTRY_DISABLE=true
    enabled: process.env['SENTRY_DISABLE'] !== 'true',
    tracesSampleRate: 0.2,
    beforeSend(event) {
      return scrubPii(event);
    },
  });
}

export { Sentry };
