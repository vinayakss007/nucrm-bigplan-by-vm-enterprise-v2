/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

/**
 * The subscription console's cancel-confirmation dialog (#2872 extraction).
 *
 * Moved out of `app/tenant/settings/billing/subscription/page.tsx` verbatim — same markup, same
 * controlled inputs, same submit gate — so the page, which sits exactly on its file-size
 * ceiling, had room for the read channels it now derives. The reason/feedback state stays in
 * the page, because it survives closing the dialog: moving it here would clear a half-written
 * reason the moment the operator pressed "Keep Subscription".
 */
import { AlertTriangle, Loader2, X } from 'lucide-react';

export default function SubscriptionCancelDialog({
  reason, feedback, onReasonChange, onFeedbackChange, submitting, onClose, onCancel,
}: {
  reason: string;
  feedback: string;
  onReasonChange: (value: string) => void;
  onFeedbackChange: (value: string) => void;
  submitting: boolean;
  onClose: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card rounded-2xl border border-border shadow-lg w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/20">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Cancel Subscription</h2>
              <p className="text-sm text-muted-foreground">This action cannot be undone</p>
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Your subscription will remain active until the end of the current billing period.
              </p>
              <p className="text-xs text-amber-600/70 mt-1">
                After cancellation, your data will be retained for 30 days.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Reason for cancellation</label>
              <select
                value={feedback}
                onChange={(e) => onFeedbackChange(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a reason</option>
                <option value="too_expensive">Too expensive</option>
                <option value="missing_features">Missing features</option>
                <option value="poor_support">Poor support</option>
                <option value="switching_competitor">Switching to competitor</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Additional feedback (optional)</label>
              <textarea
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                placeholder="Help us improve..."
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm min-h-[80px]"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded-xl border border-border hover:bg-muted text-sm font-medium transition-colors"
            >
              Keep Subscription
            </button>
            <button
              onClick={onCancel}
              disabled={submitting}
              className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <X className="w-3.5 h-3.5" />
              )}
              Cancel Subscription
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
