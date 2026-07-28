'use client';

import { useState, useEffect, useCallback } from 'react';
import { Filter, Plus, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { confirmThen } from '@/components/ui/confirm-dialog';
import toast from 'react-hot-toast';

interface Segment {
  id: string;
  name: string;
  entityType: string;
  filters: Record<string, unknown>;
  matchCount?: number;
  createdAt?: string;
}

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', entityType: 'contact', filtersJson: '{}' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/segments');
      if (!res.ok) throw new Error();
      const json = await res.json();
      setSegments(json.data ?? []);
    } catch {
      toast.error('Failed to load segments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      let filters: Record<string, unknown>;
      try { filters = JSON.parse(form.filtersJson); } catch { toast.error('Invalid JSON filters'); setSaving(false); return; }
      const res = await fetch('/api/tenant/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, entity_type: form.entityType, filters }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      toast.success('Segment created');
      setShowCreate(false);
      setForm({ name: '', entityType: 'contact', filtersJson: '{}' });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (seg: Segment) => {
    confirmThen(`Delete segment "${seg.name}"?`, async () => {
      const res = await fetch(`/api/tenant/segments?id=${seg.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Deleted'); load(); } else { toast.error('Failed to delete'); }
    });
  };

  const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm';

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 shrink-0">
            <Filter className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Segments</h1>
            <p className="text-sm text-muted-foreground">Create audience segments for targeting and filtering.</p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
          <Plus className="w-4 h-4" /> New Segment
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading…</div>
      ) : segments.length === 0 ? (
        <div className="admin-card p-12 text-center">
          <Filter className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No segments yet.</p>
          <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-primary hover:underline">Create your first segment</button>
        </div>
      ) : (
        <div className="admin-card divide-y divide-border">
          {segments.map((seg) => (
            <div key={seg.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{seg.name}</p>
                <p className="text-xs text-muted-foreground">
                  {seg.entityType} &middot; {Object.keys(seg.filters ?? {}).length} filter(s)
                  {seg.matchCount !== undefined && ` &middot; ${seg.matchCount} match(es)`}
                </p>
              </div>
              <button onClick={() => handleDelete(seg)} className="p-2 rounded-lg hover:bg-destructive/10 text-destructive" aria-label={`Delete ${seg.name}`}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-card rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">New Segment</h2>
            <input className={inp} placeholder="Segment name *" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            <select className={inp} value={form.entityType} onChange={(e) => setForm(f => ({ ...f, entityType: e.target.value }))}>
              <option value="contact">Contact</option>
              <option value="lead">Lead</option>
              <option value="company">Company</option>
              <option value="deal">Deal</option>
            </select>
            <div>
              <label className="text-xs font-medium">Filters (JSON)</label>
              <textarea className={cn(inp, 'font-mono text-xs mt-1')} rows={4} value={form.filtersJson} onChange={(e) => setForm(f => ({ ...f, filtersJson: e.target.value }))} placeholder='{"status":"active"}' />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-border text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !form.name.trim()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
