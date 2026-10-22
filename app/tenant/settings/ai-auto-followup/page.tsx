/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';
import {
  Bot, Loader2, CheckCircle2, Info,
} from 'lucide-react';

type Settings = {
  autoAiEnabled: boolean;
};

const SETTINGS_QUERY = ['tenant', 'admin', 'ai-auto-followup'] as const;

export default function AIAutoFollowupPage() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  // #1328: load settings via TanStack Query (was raw fetch + useEffect).
  // retry:false — admin-only endpoint that may 404 / 403.
  const { data, isLoading: loading, error: loadError, refetch } = useApiQuery<Settings>(
    SETTINGS_QUERY,
    '/api/tenant/admin/ai-auto-followup',
    { retry: false },
  );
  const autoAiEnabled = data?.autoAiEnabled ?? false;
  // #2872: this page reads a config and PATCHes that same config, and it folded both
  // failures into one variable printed by one banner — so a refresh refused after a
  // save (onSuccess invalidates this page's own key, the ordinary state here) spoke with
  // the mutation's words, and either failure could mask the other. It also reached for
  // the error's `info` body, guessing at its shape, when `ApiQueryError.message` already
  // carries the status.
  const failed = Boolean(loadError) && !data;
  const stale = Boolean(loadError) && Boolean(data);
  const reason = loadError?.message || 'no response from the server';

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/tenant/admin/ai-auto-followup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAiEnabled: !autoAiEnabled }),
      });
      if (!r.ok) {
        const info = await r.json().catch(() => ({}));
        throw new Error(info.error ?? `HTTP ${r.status}`);
      }
    },
    onMutate: () => setSaved(false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });
  const saving = toggleMutation.isPending;
  // The write's own channel and words: its message, never the read's, and never `undefined`.
  const writeReason = toggleMutation.error?.message || 'no response from the server';

  function toggle() {
    toggleMutation.mutate();
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12 max-w-2xl">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <Bot className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">AI Auto-Follow-Up</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically draft follow-up messages for overdue tasks using AI.
          </p>
        </div>
      </div>

      {toggleMutation.error && (
        <InlineErrorState message={`Failed to save the AI auto follow-up setting: ${writeReason}`} />
      )}

      {saved && (
        <div className="rounded-xl border border-green-300 bg-green-50 dark:border-green-800/50 dark:bg-green-950/20 px-4 py-3 text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">Settings saved successfully.</span>
        </div>
      )}

      {stale && (
        <InlineErrorState
          message={`Could not refresh the auto follow-up settings, so what is below is the last read: ${reason}. A change someone else made to this switch since the fetch is not shown here, and toggling now writes over settings this page has not seen.`}
          onRetry={refetch}
        />
      )}

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : failed ? (
          // The `?? false` seed above is a DEFAULT, not the tenant's answer; showing the
          // toggle over a read that never answered invites saving a configuration the
          // tenant never set. The outage owns this gate — staleness does not.
          <InlineErrorState
            message={`Failed to load the AI auto follow-up settings: ${reason}`}
            onRetry={refetch}
          />
        ) : (
          <>
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div className="flex-1">
                <p className="text-sm font-semibold">Enable AI Auto-Follow-Up</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When enabled, the system will automatically draft follow-up messages
                  for overdue tasks that have <code>auto_ai_enabled</code> set.
                </p>
              </div>
              <button
                onClick={toggle}
                disabled={saving}
                className={`
                  relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent
                  transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2
                  disabled:opacity-50
                  ${autoAiEnabled ? 'bg-violet-600' : 'bg-input'}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0
                    transition duration-200 ease-in-out
                    ${autoAiEnabled ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </label>

            <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground space-y-2">
              <div className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">How it works</p>
                  <ul className="mt-1 space-y-1 list-disc list-inside">
                    <li>A cron job runs periodically to find overdue follow-ups with <code>auto_ai_enabled=true</code></li>
                    <li>For each, it generates a contextual follow-up message using your AI provider</li>
                    <li>The drafted message is sent as a notification to the assigned rep</li>
                    <li>The rep reviews and sends manually — nothing is sent automatically</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
