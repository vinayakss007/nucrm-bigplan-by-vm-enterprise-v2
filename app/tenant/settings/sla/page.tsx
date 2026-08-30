/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Plus, Shield, X, Loader2, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

const priorityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400',
  low: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
};

interface SlaPolicy {
  id: string;
  name: string;
  priority: string;
  responseTimeMinutes: number;
  resolutionTimeMinutes: number;
  escalationRules: unknown[];
  isActive: boolean;
  createdAt: string;
  breachCount: number;
}

const SLA_QUERY = ['tenant', 'sla'] as const;

export default function SlaPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SlaPolicy | null>(null);
  const [form, setForm] = useState({
    name: '',
    priority: 'medium' as string,
    responseTimeMinutes: 240,
    resolutionTimeMinutes: 480,
    escalationRules: '[]',
  });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  // #1328: list via TanStack Query (was raw fetch + useEffect).
  const { data, isLoading: loading, error } = useApiQuery<{ data?: SlaPolicy[] }>(
    SLA_QUERY,
    '/api/tenant/sla',
  );
  const policies: SlaPolicy[] = data?.data ?? [];
  if (error) toast.error('Failed to load SLA policies');

  const reload = () => queryClient.invalidateQueries({ queryKey: SLA_QUERY });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', priority: 'medium', responseTimeMinutes: 240, resolutionTimeMinutes: 480, escalationRules: '[]' });
    setShowModal(true);
  };

  const openEdit = (p: SlaPolicy) => {
    setEditing(p);
    setForm({
      name: p.name,
      priority: p.priority,
      responseTimeMinutes: p.responseTimeMinutes,
      resolutionTimeMinutes: p.resolutionTimeMinutes,
      escalationRules: JSON.stringify(p.escalationRules ?? [], null, 2),
    });
    setShowModal(true);
  };

  const savePolicy = useMutation({
    mutationFn: async (escalationRules: unknown[]) => {
      const payload = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        priority: form.priority,
        responseTimeMinutes: form.responseTimeMinutes,
        resolutionTimeMinutes: form.resolutionTimeMinutes,
        escalationRules,
      };
      const res = await fetch('/api/tenant/sla', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed to save');
      return Boolean(editing);
    },
    onSuccess: (wasEditing) => {
      toast.success(wasEditing ? 'Policy updated' : 'Policy created');
      setShowModal(false);
      reload();
    },
    onError: (e: Error) => toast.error(e.message || 'Failed to save'),
  });
  const saving = savePolicy.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let escalationRules: unknown[];
    try {
      escalationRules = JSON.parse(form.escalationRules);
    } catch {
      toast.error('Invalid JSON in escalation rules');
      return;
    }

    // #1342: bound the SLA times (1 minute .. 1 year) and require the
    // response target to be no later than the resolution target.
    const MAX_MINUTES = 525_600; // 365 days
    const { responseTimeMinutes: rt, resolutionTimeMinutes: rlt } = form;
    if (!Number.isFinite(rt) || rt < 1 || rt > MAX_MINUTES ||
        !Number.isFinite(rlt) || rlt < 1 || rlt > MAX_MINUTES) {
      toast.error(`Response and resolution times must be between 1 and ${MAX_MINUTES} minutes`);
      return;
    }
    if (rt > rlt) {
      toast.error('Response time cannot be longer than resolution time');
      return;
    }

    savePolicy.mutate(escalationRules);
  };

  const toggleActiveMutation = useMutation({
    mutationFn: async (p: SlaPolicy) => {
      const res = await fetch('/api/tenant/sla', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
      });
      if (!res.ok) throw new Error('Failed to update');
      return p;
    },
    onSuccess: (p) => { toast.success(p.isActive ? 'Policy deactivated' : 'Policy activated'); reload(); },
  });
  const toggleActive = (p: SlaPolicy) => toggleActiveMutation.mutate(p);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/tenant/sla', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isActive: false }),
      });
      if (!res.ok) throw new Error('Failed to remove');
    },
    onSuccess: () => { toast.success('Policy removed'); reload(); },
  });
  const del = async (id: string) => {
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">SLA Policies</h1>
          <p className="text-sm text-muted-foreground">Define response and resolution time targets for support tickets</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" />Add Policy
        </button>
      </div>

      {loading ? (
        [...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-2xl animate-pulse" />)
      ) : policies.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No SLA policies</p>
          <p className="text-sm text-muted-foreground mt-1">Create policies to define response and resolution time targets</p>
          <button onClick={openCreate} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Plus className="w-4 h-4" />Add Policy
          </button>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Priority</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Response Time</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Resolution Time</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Breaches</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', priorityColors[p.priority] || 'bg-muted text-muted-foreground')}>
                      {p.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.responseTimeMinutes}m</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.resolutionTimeMinutes}m</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', p.breachCount > 0 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400')}>
                      {p.breachCount}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(p)} className="text-muted-foreground hover:text-foreground">
                      {p.isActive ? <ToggleRight className="w-5 h-5 text-emerald-500" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(p)} className="text-xs font-medium text-muted-foreground hover:text-violet-600 border border-border rounded-lg px-2.5 py-1 hover:border-violet-300 transition-colors">
                        Edit
                      </button>
                      <button onClick={() => del(p.id)} className="text-muted-foreground hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{editing ? 'Edit Policy' : 'New SLA Policy'}</h3>
              <button onClick={() => setShowModal(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inp} placeholder="e.g. Critical Response SLA" />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Priority *</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className={inp}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Response Time (min)</label>
                  <input type="number" min={1} max={525600} value={form.responseTimeMinutes} onChange={e => setForm(f => ({ ...f, responseTimeMinutes: Number(e.target.value) }))} className={inp} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Resolution Time (min)</label>
                  <input type="number" min={1} max={525600} value={form.resolutionTimeMinutes} onChange={e => setForm(f => ({ ...f, resolutionTimeMinutes: Number(e.target.value) }))} className={inp} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Escalation Rules (JSON)</label>
                <textarea rows={4} value={form.escalationRules} onChange={e => setForm(f => ({ ...f, escalationRules: e.target.value }))} className={cn(inp, 'font-mono text-xs')} placeholder="[]" />
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
