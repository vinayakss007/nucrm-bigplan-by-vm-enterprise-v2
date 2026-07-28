'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface ActivityItem {
  id: string;
  action: string;
  entityType?: string;
  entityId?: string;
  description?: string | null;
  createdAt: string;
  userName?: string | null;
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-500',
  update: 'bg-blue-500',
  delete: 'bg-red-500',
  assign: 'bg-violet-500',
  convert: 'bg-amber-500',
};

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/activities?limit=${limit}&offset=${offset}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setActivities(json.data ?? []);
      setTotal(json.total ?? json.data?.length ?? 0);
    } catch {
      toast.error('Failed to load activities');
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-orange-500 to-rose-600 shrink-0">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Activity Feed</h1>
          <p className="text-sm text-muted-foreground">Unified timeline of all actions across contacts, deals, tasks and more.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
      ) : activities.length === 0 ? (
        <div className="admin-card p-12 text-center">
          <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No activities recorded yet.</p>
        </div>
      ) : (
        <>
          <div className="admin-card divide-y divide-border">
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-5 py-3">
                <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${ACTION_COLORS[a.action] ?? 'bg-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{a.userName ?? 'System'}</span>{' '}
                    <span className="text-muted-foreground">{a.action}</span>{' '}
                    {a.entityType && <span className="text-muted-foreground">{a.entityType}</span>}
                  </p>
                  {a.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{a.description}</p>}
                  <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0} className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40">Previous</button>
              <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
              <button onClick={() => setOffset(offset + limit)} disabled={currentPage >= totalPages} className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40">Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
