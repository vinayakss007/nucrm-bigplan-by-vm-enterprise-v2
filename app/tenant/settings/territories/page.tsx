'use client';
import { useState, useEffect } from 'react';
import { Plus, Map, X, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const TERRITORY_TYPES = ['geographic', 'vertical', 'custom'] as const;

const typeColors: Record<string, string> = {
  geographic: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  vertical: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
  custom: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
};

interface Territory {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  geoConfig: Record<string, unknown>;
  children?: Territory[];
  createdAt: string;
}

export default function TerritoriesPage() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Territory | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'geographic' as string,
    parentId: '' as string,
    geoConfig: '{}',
  });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const flattenTree = (nodes: Territory[], depth = 0): Array<Territory & { depth: number }> => {
    const result: Array<Territory & { depth: number }> = [];
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (node.children?.length) {
        result.push(...flattenTree(node.children, depth + 1));
      }
    }
    return result;
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/territories');
      if (res.ok) {
        const d = await res.json();
        setTerritories(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const allTerritories = flattenTree(territories);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'geographic', parentId: '', geoConfig: '{}' });
    setShowModal(true);
  };

  const openEdit = (t: Territory) => {
    setEditing(t);
    setForm({
      name: t.name,
      type: t.type,
      parentId: t.parentId || '',
      geoConfig: JSON.stringify(t.geoConfig ?? {}, null, 2),
    });
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let geoConfig: Record<string, unknown>;
      try {
        geoConfig = JSON.parse(form.geoConfig);
      } catch {
        toast.error('Invalid JSON in geo config');
        setSaving(false);
        return;
      }

      const payload = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        type: form.type,
        parentId: form.parentId || null,
        geoConfig,
      };

      const res = await fetch('/api/tenant/territories', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success(editing ? 'Territory updated' : 'Territory created');
        setShowModal(false);
        load();
      } else {
        toast.error(d.error || 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    const res = await fetch(`/api/tenant/territories?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Territory deleted');
      load();
    }
  };

  const findName = (id: string | null): string => {
    if (!id) return '-';
    const found = allTerritories.find(t => t.id === id);
    return found?.name || '-';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Territories</h1>
          <p className="text-sm text-muted-foreground">Organize your sales regions and assign team members to specific territories</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" />Add Territory
        </button>
      </div>

      {loading ? (
        [...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-2xl animate-pulse" />)
      ) : allTerritories.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Map className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No territories</p>
          <p className="text-sm text-muted-foreground mt-1">Create territories to organize your sales regions</p>
          <button onClick={openCreate} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Plus className="w-4 h-4" />Add Territory
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {allTerritories.map(t => (
            <div key={t.id} className="admin-card p-4" style={{ marginLeft: `${t.depth * 24}px` }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
                  <Map className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{t.name}</p>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', typeColors[t.type] || 'bg-muted text-muted-foreground')}>
                      {t.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Parent: <strong>{findName(t.parentId)}</strong></span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(t)} className="text-xs font-medium text-muted-foreground hover:text-violet-600 border border-border rounded-lg px-2.5 py-1 hover:border-violet-300 transition-colors">
                    Edit
                  </button>
                  <button onClick={() => del(t.id)} className="text-muted-foreground hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{editing ? 'Edit Territory' : 'New Territory'}</h3>
              <button onClick={() => setShowModal(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inp} placeholder="e.g. North America" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Type *</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={inp}>
                    {TERRITORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Parent</label>
                  <select value={form.parentId} onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))} className={inp}>
                    <option value="">None (root)</option>
                    {allTerritories
                      .filter(t => t.id !== editing?.id)
                      .map(t => <option key={t.id} value={t.id}>{'  '.repeat(t.depth)}{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Geo Config (JSON)</label>
                <textarea rows={5} value={form.geoConfig} onChange={e => setForm(f => ({ ...f, geoConfig: e.target.value }))} className={cn(inp, 'font-mono text-xs')} placeholder="{}" />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" disabled={saving || !form.name}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
