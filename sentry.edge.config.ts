// Sentry Edge config (for middleware, etc.)
import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env['SENTRY_DSN'];

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    enabled: process.env['SENTRY_ENABLE'] !== 'false',
    tracesSampleRate: 0.2,
  });
}

export { Sentry };
