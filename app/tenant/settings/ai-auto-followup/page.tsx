/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useEffect, useState } from 'react';
import {
  Bot, Loader2, AlertCircle, CheckCircle2, Info,
} from 'lucide-react';

type Settings = {
  autoAiEnabled: boolean;
};

export default function AIAutoFollowupPage() {
  const [settings, setSettings] = useState<Settings>({ autoAiEnabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/tenant/admin/ai-auto-followup', { cache: 'no-store', signal: controller.signal })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(data => setSettings({ autoAiEnabled: data.autoAiEnabled ?? false }))
      .catch(e => {
        if (e?.name === 'AbortError') return;
        setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function toggle() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch('/api/tenant/admin/ai-auto-followup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoAiEnabled: !settings.autoAiEnabled }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      setSettings(s => ({ ...s, autoAiEnabled: !s.autoAiEnabled }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
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

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
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
                  ${settings.autoAiEnabled ? 'bg-violet-600' : 'bg-input'}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0
                    transition duration-200 ease-in-out
                    ${settings.autoAiEnabled ? 'translate-x-5' : 'translate-x-0'}
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
