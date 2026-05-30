'use client';
import { useEffect, useState } from 'react';
import {
  Target, Plus, Save, X, Sparkles, AlertCircle, Loader2, Trash2, Edit2, RefreshCw, GripVertical, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Rule = {
  id: string | null;
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
  const [editing, setEditing] = useState<Rule | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetch('/api/tenant/admin/lead-scoring')
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        setRules(body.rules);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function save(r: Rule) {
    setBusy('save');
    setError(null);
    try {
      const method = r.id ? 'PATCH' : 'POST';
      const resp = await fetch('/api/tenant/admin/lead-scoring', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error ?? `HTTP ${resp.status}`);
      setEditing(null);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function remove(id: string) {
    if (!confirm('Remove this scoring rule?')) return;
    setBusy('delete:' + id);
    try {
      const r = await fetch(`/api/tenant/admin/lead-scoring?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error ?? 'Delete failed');
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
    } catch (e) { setError('Failed to install some starters'); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <Target className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Lead scoring rules</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Configure how the AI ranks your leads. Rules can be positive (bonuses) or negative (penalties). The higher the final score, the higher the priority in the lead queue.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
        </button>
        <button
          onClick={() => setEditing({ id: null, factor: '', weight: 10, condition: '', sortOrder: rules.length + 1, active: true })}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> New rule
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[40px_1fr_100px_100px_120px] items-center gap-4 px-4 py-2 bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <div className="text-center">#</div>
          <div>Factor & Condition</div>
          <div className="text-center">Weight</div>
          <div className="text-center">Status</div>
          <div className="text-right pr-2">Actions</div>
        </div>

        {loading && rules.length === 0 && (
          <div className="p-12 text-center text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Loading rules...
          </div>
        )}

        {!loading && rules.length === 0 && (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground">No scoring rules configured yet.</p>
            <button
              onClick={installStarters}
              disabled={busy === 'starters'}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-sm font-medium disabled:opacity-50"
            >
              {busy === 'starters' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Install recommended starter rules
            </button>
          </div>
        )}

        <div className="divide-y divide-border">
          {rules.map((r, i) => (
            <div key={r.id} className={cn(
              "grid grid-cols-[40px_1fr_100px_100px_120px] items-center gap-4 px-4 py-3 hover:bg-muted/10 transition-colors",
              !r.active && "opacity-60 bg-muted/5"
            )}>
              <div className="flex items-center justify-center text-muted-foreground/40 group cursor-grab">
                <GripVertical className="w-4 h-4 group-hover:text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{r.factor}</p>
                {r.condition && <code className="text-[10px] text-muted-foreground/70 font-mono mt-0.5 block truncate">{r.condition}</code>}
              </div>
              <div className="text-center">
                <span className={cn(
                  "inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded text-xs font-bold tabular-nums",
                  r.weight > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" :
                  r.weight < 0 ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" :
                  "bg-muted text-muted-foreground"
                )}>
                  {r.weight > 0 ? '+' : ''}{r.weight}
                </span>
              </div>
              <div className="text-center">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                  r.active ? "border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20" : "border-border text-muted-foreground"
                )}>
                  {r.active ? 'active' : 'disabled'}
                </span>
              </div>
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => setEditing(r)}
                  className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => r.id && remove(r.id)}
                  className="p-1.5 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600 dark:hover:bg-red-950/20 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/50 dark:border-blue-900/30 dark:bg-blue-950/10 p-4 flex gap-3">
        <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-blue-900 dark:text-blue-300">How scoring works</p>
          <p className="text-blue-700/80 dark:text-blue-400/70 mt-1 leading-relaxed">
            The system periodically scans your leads and applies these rules. If multiple rules match, their weights are summed. High-weight factors (e.g. 50+) significantly move leads to the top of the queue. Use negative weights to penalize junk leads without deleting them.
          </p>
        </div>
      </div>

      {editing && (
        <RuleEditor
          rule={editing}
          busy={busy === 'save'}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function RuleEditor({ rule, busy, onClose, onSave }: { rule: Rule; busy: boolean; onClose: () => void; onSave: (r: Rule) => void }) {
  const [draft, setDraft] = useState<Rule>({ ...rule });
  const isNew = !draft.id;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/10">
          <h2 className="text-lg font-bold">{isNew ? 'New Scoring Rule' : 'Edit Rule'}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-accent"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Factor Name</label>
            <input
              autoFocus
              value={draft.factor}
              onChange={e => setDraft(d => ({ ...d, factor: e.target.value }))}
              placeholder="e.g. High annual revenue"
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-background focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
            />
            <p className="text-[10px] text-muted-foreground">Internal name to describe this rule.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Weight (-100 to 100)</label>
              <input
                type="number"
                value={draft.weight}
                onChange={e => setDraft(d => ({ ...d, weight: parseInt(e.target.value) || 0 }))}
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-background focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all tabular-nums font-bold"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sort Order</label>
              <input
                type="number"
                value={draft.sortOrder}
                onChange={e => setDraft(d => ({ ...d, sortOrder: parseInt(e.target.value) || 0 }))}
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-background focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex justify-between">
              Condition <span className="font-normal lowercase italic">SQL-like or prompt hint</span>
            </label>
            <textarea
              value={draft.condition ?? ''}
              onChange={e => setDraft(d => ({ ...d, condition: e.target.value }))}
              rows={3}
              placeholder="e.g. contact.lead_source = 'Organic'"
              className="w-full px-4 py-2.5 rounded-xl border border-border bg-background focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-mono text-xs"
            />
          </div>

          <label className="flex items-center gap-3 py-1 cursor-pointer group">
            <div className={cn(
              "w-10 h-5 rounded-full transition-colors relative",
              draft.active ? "bg-blue-600" : "bg-muted"
            )}>
              <div className={cn(
                "absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform",
                draft.active && "translate-x-5"
              )} />
            </div>
            <input
              type="checkbox"
              className="hidden"
              checked={draft.active}
              onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}
            />
            <span className="text-sm font-medium">Rule is active</span>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-border bg-muted/5 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-border hover:bg-accent text-sm font-medium">Cancel</button>
          <button
            onClick={() => onSave(draft)}
            disabled={busy || !draft.factor.trim()}
            className="flex items-center gap-2 px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-lg shadow-blue-500/20 disabled:opacity-50 transition-all active:scale-95"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isNew ? 'Create Rule' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
