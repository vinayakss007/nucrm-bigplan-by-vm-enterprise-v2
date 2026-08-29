/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { Plus, PieChart, Trash2 } from 'lucide-react';

interface Segment {
  id: string;
  name: string;
  entity_type?: string;
  filters?: Record<string, unknown>;
  filter_count?: number;
  created_at: string;
}

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', entity_type: 'contacts', filters: '' });

  const fetchSegments = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/tenant/segments', { signal });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (signal?.aborted) return;
      setSegments(data.data ?? data.segments ?? data ?? []);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      toast.error('Failed to load segments');
    } finally {
      if (signal?.aborted) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchSegments(controller.signal);
    return () => controller.abort();
  }, [fetchSegments]);

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return; }
    let filters = {};
    if (form.filters.trim()) {
      try { filters = JSON.parse(form.filters); } catch { toast.error('Invalid JSON filters'); return; }
    }
    try {
      const res = await fetch('/api/tenant/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, entity_type: form.entity_type, filters }),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Create failed'); return; }
      toast.success('Segment created');
      setShowCreate(false);
      setForm({ name: '', entity_type: 'contacts', filters: '' });
      fetchSegments();
    } catch { toast.error('Create failed'); }
  };

  const handleDelete = async (id: string) => {
    await confirmThen('Delete this segment?', async () => {
      try {
        const res = await fetch(`/api/tenant/segments/${id}`, { method: 'DELETE' });
        if (!res.ok) { toast.error('Delete failed'); return; }
        toast.success('Segment deleted');
        fetchSegments();
      } catch { toast.error('Delete failed'); }
    });
  };

  if (loading) return <div className="p-6 animate-pulse"><div className="h-8 bg-muted rounded w-48 mb-4" /><div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded" />)}</div></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Segments</h1>
        <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-2" />New Segment</Button>
      </div>

      {showCreate && (
        <div className="border rounded-lg p-4 space-y-3 bg-card">
          <h2 className="font-semibold">Create Segment</h2>
          <input className="w-full border rounded px-3 py-2 bg-background" placeholder="Segment name *" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          <select className="w-full border rounded px-3 py-2 bg-background" value={form.entity_type} onChange={e => setForm({...form, entity_type: e.target.value})}>
            <option value="contacts">Contacts</option>
            <option value="companies">Companies</option>
            <option value="leads">Leads</option>
            <option value="deals">Deals</option>
          </select>
          <textarea className="w-full border rounded px-3 py-2 bg-background font-mono text-sm" placeholder='Filters (JSON, e.g. {"status": "active"})' value={form.filters} onChange={e => setForm({...form, filters: e.target.value})} />
          <div className="flex gap-2">
            <Button onClick={handleCreate}>Create</Button>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {segments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <PieChart className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No segments defined. Create your first audience segment above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {segments.map(s => (
            <div key={s.id} className="border rounded-lg p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  {s.entity_type && <span className="text-xs px-1.5 py-0.5 bg-muted rounded">{s.entity_type}</span>}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {s.filter_count !== undefined && <span>{s.filter_count} filter{s.filter_count !== 1 ? 's' : ''}</span>}
                  <span className="ml-3">Created {new Date(s.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)} className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
