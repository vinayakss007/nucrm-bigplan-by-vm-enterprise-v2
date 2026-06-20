'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Settings, Trash2, ToggleLeft, ToggleRight, Loader2, Users, MapPin, Brain, Shuffle } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';

interface AssignmentRule {
  id: string;
  name: string;
  type: 'round_robin' | 'territory' | 'skill_based' | 'weighted';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
  isActive: boolean;
  priority: number;
  entityType: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TYPE_CONFIG: Record<string, { label: string; icon: any; description: string }> = {
  round_robin: { label: 'Round Robin', icon: Users, description: 'Assign to next member in sequence' },
  territory: { label: 'Territory', icon: MapPin, description: 'Assign based on geographic territory' },
  skill_based: { label: 'Skill Based', icon: Brain, description: 'Match skills to requirements' },
  weighted: { label: 'Weighted', icon: Shuffle, description: 'Weighted random distribution' },
};

export default function AssignmentConfig({ teamMembers = [] }: { teamMembers?: { user_id: string; full_name: string }[] }) {
  const [rules, setRules] = useState<AssignmentRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const loadRules = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/assignment-rules', { signal });
      const data = await res.json();
      if (!signal?.aborted) setRules(data.data ?? []);
    } catch { if (!signal?.aborted) setRules([]); }
    if (!signal?.aborted) setLoading(false);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    loadRules(abort.signal);
    return () => abort.abort();
  }, [loadRules]);

  const toggleRule = async (id: string, current: boolean) => {
    const res = await fetch(`/api/tenant/assignment-rules`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !current }),
    });
    if (res.ok) {
      setRules(p => p.map(r => r.id === id ? { ...r, isActive: !current } : r));
      toast.success(current ? 'Rule disabled' : 'Rule enabled');
    } else toast.error('Failed to toggle');
  };

  const deleteRule = async (id: string) => {
    const res = await fetch(`/api/tenant/assignment-rules?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setRules(p => p.filter(r => r.id !== id));
      toast.success('Rule deleted');
    } else toast.error('Failed to delete');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2"><Settings className="w-4 h-4" />Assignment Rules</h3>
          <p className="text-xs text-muted-foreground">Auto-assign leads, deals, and tickets to team members</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />Add Rule
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rules.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">No assignment rules configured</div>
      ) : (
        <div className="space-y-2">
          {rules.sort((a, b) => a.priority - b.priority).map((rule, i) => {
            const cfg = TYPE_CONFIG[rule.type] || TYPE_CONFIG['round_robin']!;
            const Icon = cfg.icon;
            return (
              <div key={rule.id} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">#{i + 1}</span>
                    <p className="text-sm font-medium truncate">{rule.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-muted-foreground capitalize">{rule.type.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 capitalize">{rule.entityType}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{cfg?.description ?? ''}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleRule(rule.id, rule.isActive)}
                    className={cn('p-1.5 rounded-lg transition-colors', rule.isActive ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20' : 'text-muted-foreground hover:bg-accent')}>
                    {rule.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button onClick={() => deleteRule(rule.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <AssignmentRuleForm
          teamMembers={teamMembers}
          onSaved={() => { loadRules(); setShowForm(false); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AssignmentRuleForm({ _teamMembers, onSaved, onClose }: any) {
  const [form, setForm] = useState({
    name: '',
    type: 'round_robin',
    entity_type: 'lead',
    config: '{}',
  });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const configObj = JSON.parse(form.config);
      const res = await fetch('/api/tenant/assignment-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          entity_type: form.entity_type,
          config: configObj,
        }),
      });
      if (res.ok) {
        toast.success('Rule created');
        onSaved();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed');
      }
    } catch {
      toast.error('Invalid JSON in config');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">New Assignment Rule</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Rule Name *</label>
            <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inp} placeholder="e.g. West Coast Leads" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} className={inp}>
                <option value="round_robin">Round Robin</option>
                <option value="territory">Territory</option>
                <option value="skill_based">Skill Based</option>
                <option value="weighted">Weighted</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Entity</label>
              <select value={form.entity_type} onChange={e => setForm(p => ({ ...p, entity_type: e.target.value }))} className={inp}>
                <option value="lead">Lead</option>
                <option value="ticket">Ticket</option>
                <option value="deal">Deal</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Config (JSON)</label>
            <textarea value={form.config} onChange={e => setForm(p => ({ ...p, config: e.target.value }))}
              rows={4} className={inp + ' font-mono text-xs resize-none'}
              placeholder='{"team_members": ["user-id-1", "user-id-2"]}' />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
