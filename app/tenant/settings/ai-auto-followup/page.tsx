/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery, ApiQueryError } from '@/lib/query/client';
import {
  Bot, Loader2, AlertCircle, CheckCircle2, Info,
} from 'lucide-react';

type Settings = {
  autoAiEnabled: boolean;
};

export default function AIAutoFollowupPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // #1328: load settings via TanStack Query (was raw fetch + useEffect).
  // retry:false — admin-only endpoint that may 404 / 403.
  const { data, isLoading: loading, error: loadError } = useApiQuery<Settings>(
    ['tenant', 'admin', 'ai-auto-followup'],
    '/api/tenant/admin/ai-auto-followup',
    { retry: false },
  );
  const autoAiEnabled = data?.autoAiEnabled ?? false;
  const loadErrorMessage = loadError
    ? ((loadError.info as { error?: string })?.error ?? loadError.message)
    : null;
  const displayError = error ?? loadErrorMessage;

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/tenant/admin/ai-auto-followup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAiEnabled: !autoAiEnabled }),
      });
      if (!r.ok) {
        const info = await r.json().catch(() => ({}));
        throw new ApiQueryError(info.error ?? `HTTP ${r.status}`, r.status, info);
      }
    },
    onMutate: () => { setError(null); setSaved(false); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', 'admin', 'ai-auto-followup'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e: Error) => setError(e.message),
  });
  const saving = toggleMutation.isPending;

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

      {displayError && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{displayError}</span>
        </div>
      )}

      {saved && (
        <div className="rounded-xl border border-green-300 bg-green-50 dark:border-green-800/50 dark:bg-green-950/20 px-4 py-3 text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">Settings saved successfully.</span>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
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
