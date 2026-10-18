/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Inline error affordance with retry (#2231).
 *
 * `ErrorFallback` (components/shared/error-fallback.tsx) is the established
 * "Try again" pattern, but it is a large route-boundary block. This is its
 * compact sibling: a single-line banner for search dropdowns, list headers,
 * and rosters, so an API failure renders an explicit error + retry instead of
 * a false-empty state or a frozen spinner.
 *
 * #2829 added the second line. Panels that read `{ data }` and never bind
 * `error` render "there are none" for a failed request, so the banner has to
 * say out loud that it is *not* the empty state. That distinction is what
 * `settings/rbac/page.tsx:227`, `superadmin/selective-restore/page.tsx:469` and
 * `superadmin/token-control/page.tsx:293` each wrote out by hand in their own
 * wording; here it is one constant, opt-in per call site, because the #2231
 * sites show stale rows rather than an empty list and their message already
 * says so.
 */
export const FAILED_IS_NOT_EMPTY = 'An empty list means the endpoint answered successfully with nothing; this message means it did not.';

export interface InlineErrorStateProps {
  /** Human-readable failure description (never a raw Error object). */
  message: string;
  /** A second, quieter line. Panels replacing an empty state pass `FAILED_IS_NOT_EMPTY`. */
  detail?: string;
  /** Re-run the failed request. Renders the "Try again" button when provided. */
  onRetry?: () => void;
  className?: string;
}

export default function InlineErrorState({ message, detail, onRetry, className }: InlineErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start justify-between gap-3 px-3 py-2 text-sm rounded-xl border',
        'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400',
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate">{message}</span>
          {detail && <span className="mt-0.5 block text-xs font-normal opacity-80">{detail}</span>}
        </span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        >
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}
