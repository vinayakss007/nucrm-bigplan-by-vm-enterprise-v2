/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Sentry Edge config (for middleware, etc.)
import * as Sentry from '@sentry/nextjs';
import { scrubPii } from './sentry-pii-scrub';

const SENTRY_DSN = process.env['SENTRY_DSN'];

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

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
