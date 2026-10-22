/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import InlineErrorState from '@/components/shared/inline-error-state';

/**
 * One read's failure story on the development dashboard (#2872).
 *
 * The dashboard polls four reads (metrics, request log, slow queries, error log). Before this, a read
 * that never answered left its tab rendering an empty list (or, for the metrics read, took the whole
 * Overview blank with `data && …`) with no branch for a failed read — so an outage looked like "the dev
 * is quiet, zero errors logged". This names the two channels the epic asks for, per read:
 *
 *   - `failed` (error and nothing was ever read) → an outage banner; the tab is NOT claiming an absence.
 *   - `stale` (error and the read had already succeeded) → the rows stay on screen under a caveat.
 *   - neither (the read answered) → renders nothing, silent.
 *
 * `read.reason` is already defaulted by the caller to a messageless-safe string, so a bare `Error`
 * never prints `undefined`.
 */
export interface DevReadState {
  failed: boolean;
  stale: boolean;
  reason: string;
}

export interface DevReadNoticeProps {
  read: DevReadState;
  /** What this read backs, in operator words (e.g. "the request log"). */
  label: string;
  /** Re-run only THIS read's own query. */
  onRetry: () => void;
  /** What the refusal on a kept read hides, named out loud. */
  consequence: string;
}

export default function DevReadNotice({ read, label, onRetry, consequence }: DevReadNoticeProps) {
  if (read.failed) {
    return (
      <InlineErrorState
        message={`Failed to load ${label}: ${read.reason}. Nothing shown for it is an answer — this is not a verdict that there is nothing to report.`}
        onRetry={onRetry}
      />
    );
  }
  if (read.stale) {
    return (
      <InlineErrorState
        message={`Could not refresh, so ${label} are the last read: ${read.reason}. ${consequence}`}
        onRetry={onRetry}
      />
    );
  }
  return null;
}
