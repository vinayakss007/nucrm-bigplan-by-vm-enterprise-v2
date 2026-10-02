/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Sentry server-side configuration
import * as Sentry from '@sentry/nextjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrubPii } from './sentry-pii-scrub';

const SENTRY_DSN = process.env['SENTRY_DSN'];

const SENTRY_ENVIRONMENT = process.env['SENTRY_ENVIRONMENT'] || process.env['NODE_ENV'] || 'development';

/**
 * Without a release, every event from every deploy lands in the same bucket and
 * there is no way to say "this started at the last push". The deploy normally
 * supplies SENTRY_RELEASE; `.git` is excluded from the image build context, so
 * the SDK cannot derive one itself, and Next's per-build id is the fallback that
 * is always present and always unique to a build.
 */
function resolveRelease(): string | undefined {
  if (process.env['SENTRY_RELEASE'] || process.env['NEXT_PUBLIC_SENTRY_RELEASE']) {
    return process.env['SENTRY_RELEASE'] || process.env['NEXT_PUBLIC_SENTRY_RELEASE'] || undefined;
  }
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

const SENTRY_RELEASE = resolveRelease();

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    ...(SENTRY_RELEASE ? { release: SENTRY_RELEASE } : {}),

    // GDPR: never send PII by default
    sendDefaultPii: false,

    // Initialize whenever a DSN is configured. Both documented opt-outs count:
    // SENTRY_DISABLE=true and SENTRY_ENABLE=false (the runbook and OPERATIONS.md
    // have always told operators the latter is the switch, so honour it rather
    // than leave a control that silently does nothing).
    enabled: process.env['SENTRY_DISABLE'] !== 'true' && process.env['SENTRY_ENABLE'] !== 'false',
    tracesSampleRate: process.env['SENTRY_TRACES_SAMPLE_RATE'] 
      ? parseFloat(process.env['SENTRY_TRACES_SAMPLE_RATE']) 
      : 0.2,
    ignoreErrors: [
      'Network Error',
      'Failed to fetch',
      'Load failed',
      'ResizeObserver loop limit exceeded',
      // NUCRM fatal seen in Sentry (abortIncoming/_http_server "Error: aborted"):
      // the client hung up mid-response. Node raises it from the server core, so
      // it is disconnect noise, never an application fault — drop it by exact
      // shape only, so real messages that merely contain "aborted" still page.
      /^aborted$/i,
      /^AbortError(?::|\s|$)/,
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
