'use client';
import { useState, useEffect } from 'react';
import { Webhook, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WebhookLog {
  id: string;
  url: string;
  status: string;
  attempt: number;
  responseStatus: number | null;
  deliveredAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  eventType: string;
}

const STATUS_FILTERS = ['all', 'pending', 'delivered', 'failed'] as const;

function getStatusConfig(status: string) {
  switch (status) {
    case 'delivered':
      return { icon: CheckCircle2, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' };
    case 'failed':
      return { icon: AlertCircle, color: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400' };
    default:
      return { icon: Clock, color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400' };
  }
}

export default function WebhookLogsPage() {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const limit = 20;

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/tenant/webhooks/logs?${params}`);
      if (res.ok) {
        const d = await res.json();
        setLogs(d.data ?? []);
        setTotal(d.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, statusFilter, load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const truncateUrl = (url: string, max = 40) => {
    return url.length > max ? url.slice(0, max) + '...' : url;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Webhook Delivery Logs</h1>
          <p className="text-sm text-muted-foreground">View delivery history and troubleshoot webhook failures</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Status:</span>
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => { setStatusFilter(f); setPage(1); }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
              statusFilter === f
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="admin-card p-5 space-y-4">
          {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Webhook className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No delivery logs</p>
          <p className="text-sm text-muted-foreground mt-1">Webhook delivery attempts will appear here</p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Event Type</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">URL</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Attempts</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">HTTP Code</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Error</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const sc = getStatusConfig(log.status);
                const StatusIcon = sc.icon;
                return (
                  <tr key={log.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{log.eventType}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs font-mono" title={log.url}>
                      {truncateUrl(log.url)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full', sc.color)}>
                        <StatusIcon className="w-3 h-3" />
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-center">{log.attempt}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.responseStatus ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-red-500 max-w-[200px] truncate" title={log.errorMessage || ''}>
                      {log.errorMessage || '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.deliveredAt || log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
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
