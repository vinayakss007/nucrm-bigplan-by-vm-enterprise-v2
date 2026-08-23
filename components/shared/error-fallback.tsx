/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useCaptureError } from '@/lib/capture-error';

/**
 * Shared fallback for Next.js `error.tsx` boundaries.
 *
 * WHY THIS EXISTS
 * ---------------
 * 22 route-segment boundaries rendered `{error.message}` straight into the page.
 * `lib/logger.ts` has `safeError()` specifically so internal failures are never
 * shown to users, and the root `app/error.tsx` already followed that rule — the
 * per-segment boundaries had drifted from it.
 *
 * Raw messages are a real leak on the client. Next.js redacts *server* component
 * errors in production, but an error thrown in a client component keeps its
 * message, so ORM text, table names and connection strings could surface in the
 * UI. Support still needs something to correlate on, which is what `digest` is
 * for: it is logged alongside the full error in Sentry.
 */

export interface ErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Sentry tag identifying which boundary caught it, e.g. "tenant error". */
  context: string;
  /** Heading text. Defaults to a generic message. */
  title?: string;
  /** Explanatory line under the heading. */
  description?: string;
  /**
   * `dark` matches the superadmin console's palette; `default` matches the
   * themed tenant/portal surfaces.
   */
  tone?: 'default' | 'dark';
  /** Fills the viewport rather than sitting inside an existing layout. */
  fullScreen?: boolean;
  children?: React.ReactNode;
}

export function ErrorFallback({
  error,
  reset,
  context,
  title = 'Something went wrong',
  description = 'An unexpected error occurred while rendering this page.',
  tone = 'default',
  fullScreen = false,
  children,
}: ErrorFallbackProps) {
  useCaptureError(error, context);

  const dark = tone === 'dark';

  return (
    <div
      className={
        fullScreen
          ? 'min-h-screen flex items-center justify-center p-4'
          : 'flex items-center justify-center h-64 p-8'
      }
      role="alert"
      // Route errors replace content without moving focus, so assistive tech
      // would otherwise announce nothing at all.
      aria-live="assertive"
    >
      <div className="text-center max-w-sm">
        <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h2 className={`font-semibold mb-1 ${dark ? 'text-white' : ''}`}>{title}</h2>
        <p className={`text-sm mb-2 ${dark ? 'text-white/40' : 'text-muted-foreground'}`}>
          {description}
        </p>

        {/* The only error detail shown to the user. Correlates with Sentry. */}
        {error.digest && (
          <p className="text-xs text-muted-foreground/50 mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}

        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 mx-auto transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Try again
        </button>

        {children}
      </div>
    </div>
  );
}

export default ErrorFallback;
