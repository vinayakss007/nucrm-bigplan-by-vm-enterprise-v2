'use client';
import { useState, useEffect } from 'react';
import { Trash2, RotateCcw, AlertTriangle, Filter, X, Clock } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  contact: { label: 'Contact',  color: 'text-violet-600 bg-violet-100 dark:bg-violet-900/20 dark:text-violet-400' },
  deal:    { label: 'Deal',     color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400' },
  task:    { label: 'Task',     color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400' },
  company: { label: 'Company',  color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400' },
};

export default function TrashPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const q = filter !== 'all' ? `?type=${filter}` : '';
    const res = await fetch('/api/tenant/trash' + q);
    const data = await res.json();
    setItems(data.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [filter]);

  const restore = async (item: any) => {
    setRestoring(item.id);
    const res = await fetch('/api/tenant/trash', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, resource_type: item.resource_type }),
    });
    const data = await res.json();
    if (res.ok) { toast.success(`${item.name} restored`); load(); }
    else toast.error(data.error);
    setRestoring(null);
  };

  const permanentDelete = async (item: any) => {
    setDeleting(item.id);
    const res = await fetch('/api/tenant/trash', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, resource_type: item.resource_type }),
    });
    const data = await res.json();
    if (res.ok) { toast.success('Permanently deleted'); load(); }
    else toast.error(data.error);
    setDeleting(null);
  };

  const filtered = filter === 'all' ? items : items.filter(i => i.resource_type === filter);

  return (
    <div className="max-w-5xl space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Trash2 className="w-5 h-5" />Trash</h1>
          <p className="text-sm text-muted-foreground">Deleted items are kept for 30 days before permanent deletion</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-700 dark:text-amber-400">
          <p className="font-medium">Items in trash are not permanently deleted yet</p>
          <p className="text-xs mt-0.5 opacity-75">Everything moved to trash stays here for 30 days. Click "Restore" to bring anything back. After 30 days items are automatically purged.</p>
        </div>
      </div>

      {/* Type filter tabs */}
      <div className="flex rounded-xl border border-border bg-muted/20 p-1 w-fit gap-0.5">
        {['all', 'contact', 'deal', 'task', 'company'].map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors',
              filter === t ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t === 'all' ? `All (${items.length})` : `${t}s (${items.filter(i => i.resource_type === t).length})`}
          </button>
        ))}
      </div>

      {/* Items list */}
      {loading ? (
        <div className="admin-card divide-y divide-border animate-pulse">
          {[...Array(4)].map((_,i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="w-8 h-8 bg-muted rounded-xl shrink-0" />
              <div className="flex-1 space-y-2"><div className="h-4 w-48 bg-muted rounded" /><div className="h-3 w-32 bg-muted rounded" /></div>
            </div>
          ))}
        </div>
      ) : !filtered.length ? (
        <div className="admin-card py-16 text-center">
          <Trash2 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
          <p className="font-semibold">Trash is empty</p>
          <p className="text-sm text-muted-foreground mt-1">
            {filter === 'all' ? 'Nothing has been deleted yet' : `No deleted ${filter}s`}
          </p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden divide-y divide-border">
          {filtered.map(item => {
            const cfg = TYPE_CONFIG[item.resource_type] ?? { label: 'Contact', color: 'text-violet-600 bg-violet-100 dark:bg-violet-900/20 dark:text-violet-400' };
            const urgent = item.days_remaining <= 3;
            return (
              <div key={item.id} className={cn('flex items-center gap-4 p-4 hover:bg-accent/20 transition-colors', urgent && 'bg-red-50/50 dark:bg-red-950/10')}>
                <span className={cn('text-[10px] font-bold px-2 py-1 rounded-full shrink-0', cfg.color)}>
                  {cfg.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {item.extra && <span className="text-xs text-muted-foreground capitalize">{item.extra}</span>}
                    {item.email && <span className="text-xs text-muted-foreground">{item.email}</span>}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />Deleted {formatRelativeTime(item.deleted_at)}
                    </span>
                  </div>
                </div>
                <div className={cn('shrink-0 flex items-center gap-1.5 text-xs font-medium', urgent ? 'text-red-500' : 'text-muted-foreground')}>
                  <Clock className="w-3 h-3" />
                  {urgent
                    ? item.days_remaining === 0 ? 'Expires today!' : `${item.days_remaining}d left`
                    : `${item.days_remaining} days left`}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => restore(item)} disabled={restoring === item.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">
                    <RotateCcw className={cn('w-3 h-3', restoring === item.id && 'animate-spin')} />
                    {restoring === item.id ? 'Restoring...' : 'Restore'}
                  </button>
                  <button onClick={() => permanentDelete(item)} disabled={deleting === item.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border hover:border-red-300 hover:text-red-500 dark:hover:border-red-700 text-xs text-muted-foreground disabled:opacity-50 transition-colors">
                    <X className="w-3 h-3" />
                    {deleting === item.id ? '...' : 'Delete forever'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
