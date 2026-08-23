/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Sentry server-side configuration
import * as Sentry from '@sentry/nextjs';
import { scrubPii } from './sentry-pii-scrub';

const SENTRY_DSN = process.env['SENTRY_DSN'];

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // GDPR: never send PII by default
    sendDefaultPii: false,

    enabled: process.env['SENTRY_ENABLE'] !== 'false',
    tracesSampleRate: process.env['SENTRY_TRACES_SAMPLE_RATE'] 
      ? parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE']) 
      : 0.2,
    ignoreErrors: [
      'Network Error',
      'Failed to fetch',
      'Load failed',
      'ResizeObserver loop limit exceeded',
    ],
    beforeSend(event) {
      return scrubPii(event);
    },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    beforeSendTransaction(event: any) {
      if (event.transaction === '/api/health') return null;
      return event;
    },
    initialScope: {
      tags: {
        service: 'nucrm-api',
        version: process.env['npm_package_version'] || '1.0.0',
      },
    },
  });
}

export { Sentry };
