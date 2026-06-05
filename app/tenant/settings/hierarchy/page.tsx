'use client';
import { useState, useEffect } from 'react';
import { Plus, Building2, X, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const RELATIONSHIP_TYPES = ['parent', 'subsidiary', 'franchise'] as const;
const AVAILABLE_PERMISSIONS = ['read_contacts', 'write_contacts', 'read_deals', 'write_deals', 'read_reports', 'manage_users'] as const;

const relationColors: Record<string, string> = {
  parent: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  subsidiary: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  franchise: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
};

interface HierarchyEntry {
  id: string;
  parentTenantId: string;
  childTenantId: string;
  relationship: string;
  createdAt: string;
}

export default function HierarchyPage() {
  const [children, setChildren] = useState<HierarchyEntry[]>([]);
  const [parents, setParents] = useState<HierarchyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    childTenantId: '',
    relationship: 'subsidiary' as string,
    permissions: [] as string[],
  });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/hierarchy');
      if (res.ok) {
        const d = await res.json();
        setChildren(d.data?.children ?? []);
        setParents(d.data?.parents ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({ childTenantId: '', relationship: 'subsidiary', permissions: [] });
    setShowModal(true);
  };

  const togglePermission = (perm: string) => {
    setForm(f => ({
      ...f,
      permissions: f.permissions.includes(perm)
        ? f.permissions.filter(p => p !== perm)
        : [...f.permissions, perm],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        childTenantId: form.childTenantId,
        relationship: form.relationship,
        permissions: form.permissions,
      };

      const res = await fetch('/api/tenant/hierarchy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Relationship created');
        setShowModal(false);
        load();
      } else {
        toast.error(d.error || 'Failed to create');
      }
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    const res = await fetch(`/api/tenant/hierarchy?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Relationship removed');
      load();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Organization Hierarchy</h1>
          <p className="text-sm text-muted-foreground">Manage parent-child relationships between organizations</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" />Add Relationship
        </button>
      </div>

      {loading ? (
        [...Array(2)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)
      ) : children.length === 0 && parents.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No hierarchy relationships</p>
          <p className="text-sm text-muted-foreground mt-1">Link child organizations to manage multi-tenant hierarchies</p>
          <button onClick={openCreate} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Plus className="w-4 h-4" />Add Relationship
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Children section */}
          {children.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">Child Organizations</h2>
              <div className="space-y-2">
                {children.map(c => (
                  <div key={c.id} className="admin-card p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-950/40 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm font-mono">{c.childTenantId}</p>
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', relationColors[c.relationship] || 'bg-muted text-muted-foreground')}>
                            {c.relationship}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">Added {new Date(c.createdAt).toLocaleDateString()}</p>
                      </div>
                      <button onClick={() => del(c.id)} className="text-muted-foreground hover:text-red-500 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Parents section */}
          {parents.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">Parent Organizations</h2>
              <div className="space-y-2">
                {parents.map(p => (
                  <div key={p.id} className="admin-card p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm font-mono">{p.parentTenantId}</p>
                          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', relationColors[p.relationship] || 'bg-muted text-muted-foreground')}>
                            {p.relationship}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">Since {new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Relationship Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Add Child Relationship</h3>
              <button onClick={() => setShowModal(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Child Tenant ID *</label>
                <input value={form.childTenantId} onChange={e => setForm(f => ({ ...f, childTenantId: e.target.value }))} required className={inp} placeholder="e.g. tenant_abc123" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Relationship Type</label>
                <select value={form.relationship} onChange={e => setForm(f => ({ ...f, relationship: e.target.value }))} className={inp}>
                  {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-3">Permissions</label>
                <div className="grid grid-cols-2 gap-2">
                  {AVAILABLE_PERMISSIONS.map(perm => (
                    <label key={perm} className={cn('flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm',
                      form.permissions.includes(perm) ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/20' : 'border-border hover:bg-accent')}>
                      <input type="checkbox" checked={form.permissions.includes(perm)} onChange={() => togglePermission(perm)} className="rounded border-border" />
                      <span className="text-xs">{perm.replace('_', ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" disabled={saving || !form.childTenantId}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
