'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ListChecks, ArrowRight, Calendar, CheckCircle2, Clock, AlertCircle, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FollowUp {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  status: string;
  missedDays: number | null;
  autoAiEnabled: boolean | null;
  completedAt: string | null;
  contactName: string | null;
  leadName: string | null;
  assignedToUser: string | null;
}

export default function FollowUpsPage() {
  const [data, setData] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/tenant/follow-ups?${params}`);
      if (!res.ok) throw new Error('Failed to fetch follow-ups');
      const json = await res.json();
      setData(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusColors: Record<string, string> = {
    pending: 'text-amber-600 bg-amber-50 dark:bg-amber-950/20',
    completed: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20',
    missed: 'text-red-600 bg-red-50 dark:bg-red-950/20',
    cancelled: 'text-muted-foreground bg-muted',
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ListChecks className="w-5 h-5" /> Follow-Ups
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your follow-up tasks</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-background text-sm"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="missed">Missed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Link
            href="/tenant/follow-ups/missed"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-600 text-sm font-medium hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
          >
            <AlertCircle className="w-4 h-4" /> Missed
          </Link>
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="admin-card p-4 animate-pulse">
              <div className="skeleton-shimmer h-4 w-48 rounded mb-2" />
              <div className="skeleton-shimmer h-3 w-32 rounded" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="admin-card p-8 text-center">
          <ListChecks className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No follow-ups found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {statusFilter ? 'Try changing the status filter' : 'Create a follow-up from a contact or deal'}
          </p>
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="space-y-2">
          {data.map((fu) => (
            <div key={fu.id} className="admin-card p-4 hover:border-violet-200 dark:hover:border-violet-800 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{fu.title}</p>
                  {fu.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{fu.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/70">
                    {fu.dueDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(fu.dueDate).toLocaleDateString()}
                      </span>
                    )}
                    {fu.contactName && <span>{fu.contactName}</span>}
                    {fu.leadName && <span>{fu.leadName}</span>}
                    {fu.assignedToUser && <span>Assigned to {fu.assignedToUser}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-medium capitalize',
                    statusColors[fu.status] ?? 'bg-muted text-muted-foreground'
                  )}>
                    {fu.status}
                  </span>
                  {fu.missedDays != null && fu.missedDays > 0 && (
                    <span className="text-xs text-red-500 font-medium whitespace-nowrap">
                      {fu.missedDays}d overdue
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
