// Next.js instrumentation - Sentry setup
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env['NEXT_RUNTIME'] === 'nodejs' && process.env['SENTRY_DSN']) {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      enabled: process.env['NODE_ENV'] === 'production' || process.env['SENTRY_ENABLE'] === 'true',
      tracesSampleRate: process.env['SENTRY_TRACES_SAMPLE_RATE'] 
        ? parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE']) 
        : 0.2,
      environment: process.env['NODE_ENV'] || 'development',
    });
  }

  if (process.env['NEXT_RUNTIME'] === 'edge' && process.env['SENTRY_DSN']) {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      enabled: process.env['SENTRY_ENABLE'] === 'true',
      tracesSampleRate: 0.2,
    });
  }
}
