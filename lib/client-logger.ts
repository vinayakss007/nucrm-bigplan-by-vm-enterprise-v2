/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import * as Sentry from '@sentry/nextjs';

/**
 * Client-side structured logger (#1340).
 *
 * The server logger in `lib/logger.ts` writes to the filesystem (`fs`/`path`)
 * and cannot be imported into `'use client'` components. In the browser, raw
 * `console.error(err)` calls (a) leak debug/PII detail into the user's console
 * and (b) never reach Sentry, so they bypass the PII scrubbing configured in
 * `sentry.client.config.ts` (`sendDefaultPii: false` + `scrubPii`).
 *
 * This helper routes client-side errors to Sentry (which is already
 * PII-scrubbed) with a stable `context` tag, and only mirrors to the browser
 * console in development so devs keep local visibility without shipping noise
 * to production users.
 *
 * Usage (drop-in replacement for `console.error` in client components):
 *   clientLogError('adoption:fetch', err);
 *   clientLogError('backups:load-schedules', err, { scheduleId });
 */
export function clientLogError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  // Route to Sentry (PII-scrubbed) in every environment where it's enabled.
  Sentry.captureException(error, {
    tags: { context },
    ...(extra ? { extra } : {}),
  });

  // Mirror to the console only in development for local debugging.
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${context}]`, error, extra ?? '');
  }
}

/**
 * Development-only diagnostic log. No-op in production so debug output never
 * ships to end users' consoles. Use for non-error tracing that used to be a
 * bare `console.log`.
 */
export function clientLogDebug(context: string, ...args: unknown[]): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${context}]`, ...args);
  }
}
