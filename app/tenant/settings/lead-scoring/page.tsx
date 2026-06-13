'use client';
import { useEffect, useState } from 'react';
import {
  Target, Plus, Save, X, AlertCircle, Loader2, Trash2, Edit2, RefreshCw, Play,
  CheckCircle2, HelpCircle, Sparkles, GripVertical
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Rule = {
  id: string;
  factor: string;
  weight: number;
  condition: string | null;
  sortOrder: number;
  active: boolean;
};

const STARTER_RULES: Omit<Rule, 'id'>[] = [
  { factor: 'Job Title contains "VP" or "Director"', weight: 40, condition: 'contact.title ~* (VP|Director|Head|Chief)', sortOrder: 1, active: true },
  { factor: 'Revenue > $10M', weight: 30, condition: 'company.annual_revenue > 10000000', sortOrder: 2, active: true },
  { factor: 'Lead Source is "Referral"', weight: 50, condition: 'contact.lead_source = Referral', sortOrder: 3, active: true },
  { factor: 'Company Size > 200 employees', weight: 20, condition: 'company.employee_count > 200', sortOrder: 4, active: true },
  { factor: 'High engagement (>5 touches)', weight: 35, condition: 'engagement_count > 5', sortOrder: 5, active: true },
  { factor: 'Stale lead (no touch > 30 days)', weight: -40, condition: 'last_engagement_days > 30', sortOrder: 6, active: true },
];

export default function LeadScoringRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recomputeResult, setRecomputeResult] = useState<{ count: number } | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetch('/api/tenant/admin/lead-scoring', { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(d => setRules(d.rules))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function save(r: Partial<Rule>) {
    setBusy('save');
    setError(null);
    try {
      const url = r.id
        ? `/api/tenant/admin/lead-scoring/${r.id}`
        : '/api/tenant/admin/lead-scoring';
      const method = r.id ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEditing(null);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this rule?')) return;
    setBusy('delete:' + id);
    try {
      const r = await fetch(`/api/tenant/admin/lead-scoring/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function installStarters() {
    setBusy('starters');
    try {
      for (const s of STARTER_RULES) {
        await fetch('/api/tenant/admin/lead-scoring', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(s),
        });
      }
      load();
    } catch { setError('Failed to install some starters'); }
    finally { setBusy(null); }
  }

  async function recompute() {
    setBusy('recompute');
    setError(null);
    setRecomputeResult(null);
    try {
      const r = await fetch('/api/tenant/admin/lead-scoring/recompute', { method: 'POST' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setRecomputeResult(body);
      setTimeout(() => setRecomputeResult(null), 5000);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shrink-0">
          <Target className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Lead Scoring Rules</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Define factors that influence AI lead scoring. AI uses these rules as weighted context when ranking your leads.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
          </button>
          <button
            onClick={recompute}
            disabled={busy === 'recompute' || rules.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300 text-sm font-medium disabled:opacity-50"
          >
            {busy === 'recompute' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Recompute all
          </button>
          <button
            onClick={() => setEditing({ factor: '', weight: 10, active: true })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
          >
            <Plus className="w-3.5 h-3.5" />New rule
          </button>
        </div>
      </div>

      {recomputeResult && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-950/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Successfully recomputed scores for <strong>{recomputeResult.count}</strong> leads.</span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-4 py-3 font-semibold w-8">#</th>
                <th className="px-4 py-3 font-semibold">Factor & Condition</th>
                <th className="px-4 py-3 font-semibold text-center w-24">Weight</th>
                <th className="px-4 py-3 font-semibold w-24">Status</th>
                <th className="px-4 py-3 font-semibold text-right w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading rules...
                  </td>
                </tr>
              )}
              {!loading && rules.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    No scoring rules defined yet.
                    <button
                      onClick={installStarters}
                      disabled={busy === 'starters'}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-sm font-medium disabled:opacity-50"
                    >
                      {busy === 'starters' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      Install recommended starter rules
                    </button>
                  </td>
                </tr>
              )}
              {rules.map((r, i) => (
                <tr key={r.id} className={cn(!r.active && 'opacity-50')}>
                  <td className="px-4 py-3 text-muted-foreground/60 text-xs font-mono">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.factor}</div>
                    {r.condition && <code className="text-[10px] bg-muted px-1 rounded text-muted-foreground">{r.condition}</code>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'px-2 py-0.5 rounded text-xs font-bold',
                      r.weight > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' :
                      r.weight < 0 ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' :
                      'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    )}>
                      {r.weight > 0 ? '+' : ''}{r.weight}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded',
                      r.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    )}>
                      {r.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditing(r)}
                        className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                        title="Edit rule"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(r.id)}
                        disabled={busy === 'delete:' + r.id}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 transition-colors"
                        title="Delete rule"
                      >
                        {busy === 'delete:' + r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20 p-4">
        <h3 className="text-sm font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2 mb-2">
          <HelpCircle className="w-4 h-4" /> How AI Lead Scoring works
        </h3>
        <div className="text-sm text-blue-700/80 dark:text-blue-400/80 space-y-2">
          <p>
            1. You define <strong>factors</strong> like &ldquo;CEO in title (+20)&rdquo; or &ldquo;Generic email domain (-10)&rdquo;.
          </p>
          <p>
            2. When a lead is scored, the AI gateway receives your rules as context alongside the lead&rsquo;s full profile.
          </p>
          <p>
            3. The AI evaluates how well the lead matches your desired profile and calculates a 0-100 score.
          </p>
          <p>
            4. Hot leads (score &gt; 80) are prioritized in the lead queue for immediate follow-up.
          </p>
          <p className="font-medium text-blue-800 dark:text-blue-300 pt-2">
            The system periodically scans your leads and applies these rules. If multiple rules match, their weights are summed. High-weight factors (e.g. 50+) significantly move leads to the top of the queue. Use negative weights to penalize junk leads without deleting them.
          </p>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-lg">{editing.id ? 'Edit rule' : 'New scoring rule'}</h2>
              <button onClick={() => setEditing(null)} className="p-1 rounded-lg hover:bg-accent"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Factor description</label>
                <input
                  autoFocus
                  value={editing.factor || ''}
                  onChange={e => setEditing(prev => ({ ...prev!, factor: e.target.value }))}
                  placeholder="e.g. Has LinkedIn profile, Fortune 500 company..."
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Weight (Points)</label>
                <input
                  type="number"
                  value={editing.weight ?? 0}
                  onChange={e => setEditing(prev => ({ ...prev!, weight: parseInt(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                />
                <p className="text-[10px] text-muted-foreground italic">Positive for boosters, negative for disqualifiers.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Condition (Optional)</label>
                <input
                  value={editing.condition ?? ''}
                  onChange={e => setEditing(prev => ({ ...prev!, condition: e.target.value }))}
                  placeholder="e.g. metadata.has_linkedin == true"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground italic">SQL-like or prompt hint condition.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sort Order</label>
                  <input
                    type="number"
                    value={editing.sortOrder ?? 0}
                    onChange={e => setEditing(prev => ({ ...prev!, sortOrder: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={editing.active ?? true}
                  onChange={e => setEditing(prev => ({ ...prev!, active: e.target.checked }))}
                  className="rounded border-border text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm font-medium">Rule is active</span>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-border bg-muted/30 flex items-center justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent">Cancel</button>
              <button
                onClick={() => save(editing)}
                disabled={busy === 'save' || !editing.factor?.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
