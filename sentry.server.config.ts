// Sentry server-side configuration
import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env['SENTRY_DSN'];

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
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
