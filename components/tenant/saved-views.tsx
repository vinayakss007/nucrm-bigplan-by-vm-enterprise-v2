'use client';
import { useState, useEffect, useCallback } from 'react';
import { Bookmark, BookmarkPlus, X, Trash2, Share2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface SavedView {
  id: string;
  name: string;
  entityType: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  filters: Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns?: any;
  isShared: boolean;
  isDefault: boolean;
  userId: string;
}

interface SavedViewsProps {
  entityType: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentFilters: Record<string, any>;
  currentQuery: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  onApplyView: (filters: Record<string, any>, query?: string) => void;
}

export function SavedViews({ entityType, currentFilters, currentQuery, onApplyView }: SavedViewsProps) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveShared, setSaveShared] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadViews = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/views?entity_type=${entityType}`, { signal });
      const data = await res.json();
      if (!signal?.aborted) setViews(data.data ?? []);
    } catch { if (!signal?.aborted) setViews([]); }
    if (!signal?.aborted) setLoading(false);
  }, [entityType]);

  useEffect(() => {
    const abort = new AbortController();
    loadViews(abort.signal);
    return () => abort.abort();
  }, [loadViews]);

  const saveView = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    const res = await fetch('/api/tenant/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: saveName.trim(),
        entity_type: entityType,
        filters: currentFilters,
        is_shared: saveShared,
      }),
    });
    if (res.ok) {
      toast.success('View saved');
      setShowSaveDialog(false);
      setSaveName('');
      loadViews();
    } else {
      const err = await res.json();
      toast.error(err.error || 'Failed to save');
    }
    setSaving(false);
  };

  const deleteView = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const res = await fetch(`/api/tenant/views/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('View deleted');
      setViews(p => p.filter(v => v.id !== id));
    } else toast.error('Failed to delete');
  };

  const applyView = (view: SavedView) => {
    const q = typeof view.filters?.['query'] === 'string' ? view.filters['query'] : currentQuery;
    onApplyView(view.filters, q);
  };

  const hasFilters = Object.keys(currentFilters).length > 0;

  return (
    <div className="flex items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-colors">
            <Bookmark className="w-3.5 h-3.5" />
            Saved Views
            {views.length > 0 && <span className="ml-0.5 text-muted-foreground">({views.length})</span>}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {loading ? (
            <div className="flex items-center justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
          ) : views.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">No saved views yet</div>
          ) : (
            views.map(v => (
              <DropdownMenuItem key={v.id} onClick={() => applyView(v)} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Bookmark className="w-3.5 h-3.5 shrink-0 text-violet-500" />
                  <span className="truncate text-sm">{v.name}</span>
                  {v.isShared && <Share2 className="w-3 h-3 text-muted-foreground shrink-0" />}
                </div>
                <button onClick={(e) => deleteView(v.id, e)}
                  className="shrink-0 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3 h-3" />
                </button>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowSaveDialog(true)} disabled={!hasFilters}>
            <BookmarkPlus className="w-3.5 h-3.5 mr-2" />
            Save current filters...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowSaveDialog(false)} />
          <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm p-5 animate-scale-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Save Current View</h3>
              <button onClick={() => setShowSaveDialog(false)} className="p-1 rounded-lg hover:bg-accent"><X className="w-4 h-4" /></button>
            </div>
            <input
              autoFocus
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              placeholder="View name..."
              onKeyDown={e => e.key === 'Enter' && saveView()}
              className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 mb-3"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground mb-4 cursor-pointer">
              <input type="checkbox" checked={saveShared} onChange={e => setSaveShared(e.target.checked)}
                className="rounded border-border" />
              Share with team
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShowSaveDialog(false)}
                className="flex-1 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors">
                Cancel
              </button>
              <button onClick={saveView} disabled={!saveName.trim() || saving}
                className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
