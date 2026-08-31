/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { AlertTriangle, RotateCcw, Trash2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import toast from 'react-hot-toast';

interface DLQEntry {
  id: string;
  jobType: string;
  jobId: string;
  queue: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  attempts: number;
  maxAttempts: number;
  status: string;
  createdAt: string;
}

const limit = 20;

export default function WebhookDLQPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  // #1328: DLQ list via TanStack Query (was raw fetch + useEffect). page is part
  // of the key so paging refetches and caches per page.
  const { data, isLoading: loading } = useApiQuery<{ data?: DLQEntry[]; total?: number }>(
    ['tenant', 'webhooks', 'dlq', { page }],
    `/api/tenant/webhooks/dlq?${new URLSearchParams({ page: String(page), limit: String(limit) })}`,
  );
  const entries: DLQEntry[] = data?.data ?? [];
  const total = data?.total ?? 0;

  const reload = () => queryClient.invalidateQueries({ queryKey: ['tenant', 'webhooks', 'dlq'] });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/tenant/webhooks/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', ids: [id] }),
      });
      const d = await res.json().catch(() => ({}));
      return d as { succeeded?: number; failed?: number };
    },
    onSuccess: (d) => {
      if ((d.succeeded ?? 0) > 0) { toast.success('Retried successfully'); reload(); }
      else toast.error((d.failed ?? 0) > 0 ? 'Retry failed' : 'No entry found');
    },
  });
  // Track which specific row is retrying so only that button shows a spinner.
  const retrying = retryMutation.isPending && retryMutation.variables
    ? new Set([retryMutation.variables])
    : new Set<string>();
  const retryEntry = (id: string) => retryMutation.mutate(id);

  const retryAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/webhooks/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry_all' }),
      });
      return (await res.json().catch(() => ({}))) as { succeeded?: number; failed?: number };
    },
    onSuccess: (d) => { toast.success(`Retried ${d.succeeded ?? 0} entries, ${d.failed ?? 0} failed`); reload(); },
  });
  const purging = retryAllMutation.isPending;
  const retryAll = () => retryAllMutation.mutate();

  const purgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/tenant/webhooks/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge', ids: [id] }),
      });
      return (await res.json().catch(() => ({}))) as { purged?: number };
    },
    onSuccess: (d) => { if ((d.purged ?? 0) > 0) { toast.success('Purged'); reload(); } },
  });

  const purgeEntry = async (id: string) => {
    await confirmThen('Permanently delete this DLQ entry?', async () => {
      purgeMutation.mutate(id);
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Dead Letter Queue</h1>
          <p className="text-sm text-muted-foreground">Failed webhook deliveries that exceeded retry limits</p>
        </div>
        {entries.length > 0 && (
          <button
            onClick={retryAll}
            disabled={purging}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            {purging ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Retry All Pending
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No dead letter entries</p>
          <p className="text-sm text-muted-foreground mt-1">Failed webhooks that exceed retry limits will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => (
            <div key={entry.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">{entry.jobType}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
                      {entry.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {entry.attempts}/{entry.maxAttempts} attempts
                    </span>
                  </div>
                  <p className="text-xs font-mono text-red-500 mb-2">{entry.errorMessage}</p>
                  {entry.payload && (
                    <pre className="text-[10px] font-mono bg-muted rounded-lg p-2 overflow-x-auto text-muted-foreground max-h-24 overflow-y-auto">
                      {JSON.stringify(entry.payload, null, 2)}
                    </pre>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Created: {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => retryEntry(entry.id)}
                    disabled={retrying.has(entry.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-accent hover:border-violet-300 disabled:opacity-50"
                  >
                    {retrying.has(entry.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Retry
                  </button>
                  <button
                    onClick={() => purgeEntry(entry.id)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                  >
                    <Trash2 className="w-3 h-3" />
                    Purge
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next<ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
