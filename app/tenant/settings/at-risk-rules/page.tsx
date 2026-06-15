'use client';
import { useEffect, useState } from 'react';
import {
  AlertTriangle, Plus, Save, AlertCircle, Loader2, Trash2, Edit2, 
  Clock, Zap, MessageSquare, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';

type AtRiskRule = {
  id: string;
  stageId: string | null;
  maxDaysIdle: number;
  maxDaysInStage: number | null;
  sentimentThreshold: number | null;
  description: string | null;
  active: boolean;
};

type Stage = {
  id: string;
  name: string;
  pipelineId: string;
};

type Pipeline = {
  id: string;
  name: string;
  stages: Stage[];
};

export default function AtRiskRulesPage() {
  const [rules, setRules] = useState<AtRiskRule[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<AtRiskRule> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    
    Promise.all([
      fetch('/api/tenant/admin/at-risk', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/tenant/pipelines', { cache: 'no-store' }).then(r => r.json())
    ])
    .then(([rulesData, pipelinesData]) => {
      setRules(rulesData);
      setPipelines(pipelinesData.data || []);
    })
    .catch(e => setError(e.message))
    .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function save(r: Partial<AtRiskRule>) {
    setBusy('save');
    setError(null);
    try {
      const url = r.id
        ? `/api/tenant/admin/at-risk/${r.id}`
        : '/api/tenant/admin/at-risk';
      const method = r.id ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_id: r.stageId,
          max_days_idle: r.maxDaysIdle,
          max_days_in_stage: r.maxDaysInStage,
          sentiment_threshold: r.sentimentThreshold,
          description: r.description,
          active: r.active
        }),
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
      const r = await fetch(`/api/tenant/admin/at-risk/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const allStages = pipelines.flatMap(p => p.stages.map(s => ({ ...s, pipelineName: p.name })));

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shrink-0">
          <AlertTriangle className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">At-Risk Detection</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Configure how NuCRM identifies stalled deals. Rules can be global or specific to a pipeline stage.
          </p>
        </div>
        <div>
          <button
            onClick={() => setEditing({ active: true, maxDaysIdle: 14, sentimentThreshold: 30, stageId: null })}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{error}</div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin mb-4" />
          <p>Loading rules...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {rules.length === 0 && !editing && (
            <div className="p-12 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center bg-muted/30">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">No at-risk rules defined</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                Deals will only be flagged based on the system default (14 days idle).
              </p>
              <button
                onClick={() => setEditing({ active: true, maxDaysIdle: 14, sentimentThreshold: 30, stageId: null })}
                className="mt-6 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors"
              >
                Create your first rule
              </button>
            </div>
          )}

          {editing && (
            <div className="bg-card border-2 border-primary rounded-2xl overflow-hidden shadow-xl ring-4 ring-primary/5">
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      Applies to
                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                    </label>
                    <select
                      value={editing.stageId || ''}
                      onChange={e => setEditing({ ...editing, stageId: e.target.value || null })}
                      className="w-full bg-background border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                    >
                      <option value="">Global (Fallback for all stages)</option>
                      {pipelines.map(p => (
                        <optgroup key={p.id} label={p.name}>
                          {p.stages.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Description (Internal)</label>
                    <input
                      type="text"
                      value={editing.description || ''}
                      onChange={e => setEditing({ ...editing, description: e.target.value })}
                      placeholder="e.g. Aggressive follow-up for high-value stages"
                      className="w-full bg-background border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                    />
                  </div>

                  <div className="space-y-4 p-4 bg-muted/30 rounded-xl border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Clock className="w-4 h-4 text-amber-500" />
                        Activity Threshold
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Max days since last activity</span>
                        <span className="font-bold text-primary">{editing.maxDaysIdle} days</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="60"
                        value={editing.maxDaysIdle || 14}
                        onChange={e => setEditing({ ...editing, maxDaysIdle: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <p className="text-[10px] text-muted-foreground italic">
                        Deals untouched for this long will be flagged.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 bg-muted/30 rounded-xl border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Zap className="w-4 h-4 text-blue-500" />
                        Stage Stagnation
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Max days in this stage</span>
                        <span className="font-bold text-primary">{editing.maxDaysInStage || 'Unlimited'}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="90"
                        value={editing.maxDaysInStage || 0}
                        onChange={e => setEditing({ ...editing, maxDaysInStage: parseInt(e.target.value) || null })}
                        className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <p className="text-[10px] text-muted-foreground italic">
                        Deals stuck here too long will be flagged regardless of activity.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 bg-muted/30 rounded-xl border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <MessageSquare className="w-4 h-4 text-purple-500" />
                        AI Sentiment Threshold
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Flag if sentiment score below</span>
                        <span className="font-bold text-primary">{editing.sentimentThreshold || 0}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editing.sentimentThreshold || 0}
                        onChange={e => setEditing({ ...editing, sentimentThreshold: parseInt(e.target.value) })}
                        className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                      <p className="text-[10px] text-muted-foreground italic">
                        AI analyzes latest email reply sentiment. 100% is very positive.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 pt-4">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={editing.active}
                        onChange={e => setEditing({ ...editing, active: e.target.checked })}
                        className="w-4 h-4 rounded border-muted text-primary focus:ring-primary"
                      />
                      <span className="text-sm font-medium group-hover:text-primary transition-colors">Rule Active</span>
                    </label>
                  </div>
                </div>
              </div>
              <div className="bg-muted/50 px-6 py-4 flex items-center justify-end gap-3 border-t">
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => save(editing)}
                  disabled={busy === 'save'}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
                >
                  {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Rule
                </button>
              </div>
            </div>
          )}

          {rules.map((rule) => {
            const stage = allStages.find(s => s.id === rule.stageId);
            return (
              <div
                key={rule.id}
                className={cn(
                  "group relative bg-card border rounded-2xl p-6 transition-all hover:border-primary/30 hover:shadow-md",
                  !rule.active && "opacity-60 grayscale-[0.5]"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg">
                        {stage ? stage.name : 'Global Fallback'}
                      </h3>
                      {!rule.active && (
                        <span className="px-2 py-0.5 rounded-full bg-muted text-[10px] font-bold uppercase tracking-wider">Inactive</span>
                      )}
                      {stage && (
                        <span className="text-[10px] text-muted-foreground px-2 py-0.5 bg-muted/50 rounded-md border">
                          {stage.pipelineName}
                        </span>
                      )}
                    </div>
                    {rule.description && (
                      <p className="text-sm text-muted-foreground italic">"{rule.description}"</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditing(rule)}
                      className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-primary"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(rule.id)}
                      disabled={busy === 'delete:' + rule.id}
                      className="p-2 hover:bg-destructive/10 rounded-lg transition-colors text-muted-foreground hover:text-destructive"
                    >
                      {busy === 'delete:' + rule.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                  <div className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-100 dark:border-amber-900/30">
                    <Clock className="w-5 h-5 text-amber-500 shrink-0" />
                    <div>
                      <div className="text-[10px] font-bold text-amber-600/70 uppercase tracking-tight">Idle Limit</div>
                      <div className="text-sm font-semibold">{rule.maxDaysIdle} days</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-xl border border-blue-100 dark:border-blue-900/30">
                    <Zap className="w-5 h-5 text-blue-500 shrink-0" />
                    <div>
                      <div className="text-[10px] font-bold text-blue-600/70 uppercase tracking-tight">Stage Limit</div>
                      <div className="text-sm font-semibold">{rule.maxDaysInStage || 'No limit'}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-xl border border-purple-100 dark:border-purple-900/30">
                    <MessageSquare className="w-5 h-5 text-purple-500 shrink-0" />
                    <div>
                      <div className="text-[10px] font-bold text-purple-600/70 uppercase tracking-tight">Sentiment</div>
                      <div className="text-sm font-semibold">{rule.sentimentThreshold || 0}% threshold</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="p-4 bg-muted/20 border border-dashed rounded-xl flex items-start gap-3">
        <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed">
          <strong>How it works:</strong> NuCRM's background engine scans your deals every night. It first looks for a rule matching the deal's specific stage. If none is found, it falls back to the "Global" rule. If no global rule is defined, the system default of 14 days idle is used. Flagged deals appear on your <a href="/tenant/ai/at-risk" className="text-primary hover:underline font-medium">At-Risk Dashboard</a>.
        </div>
      </div>
    </div>
  );
}
