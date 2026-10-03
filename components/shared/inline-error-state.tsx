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
 */
export interface InlineErrorStateProps {
  /** Human-readable failure description (never a raw Error object). */
  message: string;
  /** Re-run the failed request. Renders the "Try again" button when provided. */
  onRetry?: () => void;
  className?: string;
}

export default function InlineErrorState({ message, onRetry, className }: InlineErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-2 text-sm rounded-xl border',
        'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-600 dark:text-red-400',
        className,
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{message}</span>
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
