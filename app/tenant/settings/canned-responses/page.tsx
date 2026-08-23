/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, X, Loader2, MessageSquare, Search } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import toast from 'react-hot-toast';

interface CannedResponse {
  id: string;
  category: string;
  title: string;
  content: string;
  shortcut: string | null;
  createdAt: string;
}

const CATEGORIES = ['general', 'billing', 'technical', 'onboarding', 'sales', 'other'];

export default function CannedResponsesPage() {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [form, setForm] = useState({ category: 'general', title: '', content: '', shortcut: '' });
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set('category', categoryFilter);
      if (search) params.set('search', search);
      const res = await fetch(`/api/tenant/canned-responses?${params}`);
      if (res.ok) {
        const d = await res.json();
        setResponses(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, search]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (r: CannedResponse) => {
    setEditing(r);
    setForm({ category: r.category, title: r.title, content: r.content, shortcut: r.shortcut || '' });
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/tenant/canned-responses/${editing.id}` : '/api/tenant/canned-responses';
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success(editing ? 'Updated' : 'Created');
      setShowForm(false); setEditing(null);
      setForm({ category: 'general', title: '', content: '', shortcut: '' });
      load();
    } else {
      toast.error(typeof d.error === 'string' ? d.error : 'Validation error');
    }
    setSaving(false);
  };

  const del = async (id: string) => {
    await confirmThen('Delete this canned response?', async () => {
      await fetch(`/api/tenant/canned-responses/${id}`, { method: 'DELETE' });
      setResponses(r => r.filter(x => x.id !== id));
      toast.success('Deleted');
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Canned Responses</h1>
          <p className="text-sm text-muted-foreground">Create reusable reply templates for your support team</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditing(null); setForm({ category: 'general', title: '', content: '', shortcut: '' }); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" />Add Response
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{editing ? 'Edit' : 'New'} Canned Response</h3>
            <button onClick={() => { setShowForm(false); setEditing(null); }}><X className="w-4 h-4 text-muted-foreground" /></button>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={inp}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Shortcut (optional)</label>
                <input value={form.shortcut} onChange={e => setForm(f => ({ ...f, shortcut: e.target.value }))} className={inp} placeholder="/thanks" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required className={inp} placeholder="Thank you reply" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Content *</label>
              <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} required rows={4} className={inp} placeholder="Hi {{name}}, thank you for contacting us..." />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
              <button type="submit" disabled={saving || !form.title || !form.content}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{editing ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search responses..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm border border-border bg-transparent focus:ring-2 focus:ring-violet-500"
        >
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-2xl animate-pulse" />)}
        </div>
      ) : responses.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No canned responses</p>
          <p className="text-sm text-muted-foreground mt-1">Create templates to speed up ticket replies</p>
        </div>
      ) : (
        <div className="space-y-3">
          {responses.map(r => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold">{r.title}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{r.category}</span>
                    {r.shortcut && (
                      <code className="text-[10px] font-mono bg-violet-100 dark:bg-violet-950/40 text-violet-700 px-1.5 py-0.5 rounded">{r.shortcut}</code>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{r.content}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-violet-600 hover:bg-accent transition-colors">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => del(r.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-accent transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
