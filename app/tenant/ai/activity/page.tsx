'use client';
import { useEffect, useState, useMemo } from 'react';
import {
  Activity, RefreshCw, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2,
  Clock, Sparkles, ThumbsUp, ThumbsDown, Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Row = {
  id: string;
  action: string;
  provider: string;
  model: string | null;
  status: string;
  tokens_in: number;
  tokens_out: number;
  tokens_used: number;
  cost_cents: number;
  latency_ms: number | null;
  entity_type: string | null;
  entity_id: string | null;
  error_message: string | null;
  accepted: boolean | null;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
};

type Summary = {
  total_calls: number;
  total_tokens: number;
  total_cost_cents: number;
  success_calls: number;
  accepted_calls: number;
  rated_calls: number;
};

type Resp = {
  rows: Row[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  summary_30d: Summary;
};

const ACTIONS = ['', 'draft', 'lead_scoring', 'predict_deal', 'suggest_followup', 'summarize'];
const PROVIDERS = ['', 'openai', 'anthropic', 'groq', 'ollama'];
const STATUSES = ['', 'success', 'fallback_used', 'error', 'rate_limited'];

function fmtCost(cents: number): string {
  if (!cents) return '$0';
  if (cents < 100) return `$${(cents / 100).toFixed(3)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  anthropic: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  groq:      'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  ollama:    'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
};

const STATUS_COLORS: Record<string, string> = {
  success:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  fallback_used: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  error:         'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  rate_limited:  'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

export default function AIActivityPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ action: '', provider: '', status: '' });
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('pageSize', '25');
    if (filters.action) p.set('action', filters.action);
    if (filters.provider) p.set('provider', filters.provider);
    if (filters.status) p.set('status', filters.status);
    return p.toString();
  }, [page, filters]);

  function load() {
    setLoading(true);
    setError(null);
    fetch(`/api/tenant/ai/activity?${qs}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(e => { console.error('[json] parse error:', e); return {}; })).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [qs]);

  async function rate(id: string, accepted: boolean) {
    try {
      const r = await fetch('/api/tenant/ai/activity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, accepted }),
      });
      if (!r.ok) throw new Error((await r.json().catch(e => { console.error('[json] parse error:', e); return {}; })).error ?? 'Failed');
      // Optimistic update
      setData(prev => prev ? {
        ...prev,
        rows: prev.rows.map(row => row.id === id ? { ...row, accepted } : row),
      } : prev);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const summary = data?.summary_30d;
  const acceptanceRate = summary && summary.rated_calls > 0
    ? Math.round((summary.accepted_calls / summary.rated_calls) * 100)
    : null;

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* Hero */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <Activity className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">AI Activity Log</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Every AI invocation across the workspace — provider, model, tokens, cost, latency, and acceptance.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* 30-day summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Calls (30d)" value={summary?.total_calls ?? 0} />
        <Stat label="Tokens (30d)" value={(summary?.total_tokens ?? 0).toLocaleString()} />
        <Stat label="Cost (30d)" value={fmtCost(summary?.total_cost_cents ?? 0)} />
        <Stat label="Success rate" value={
          summary && summary.total_calls > 0
            ? `${Math.round((summary.success_calls / summary.total_calls) * 100)}%`
            : '—'
        } />
        <Stat
          label="Acceptance"
          value={acceptanceRate === null ? '—' : `${acceptanceRate}%`}
          hint={summary ? `${summary.accepted_calls}/${summary.rated_calls} rated` : undefined}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
        <SelectField label="Action" value={filters.action} options={ACTIONS}
          onChange={v => { setFilters(f => ({ ...f, action: v })); setPage(1); }} />
        <SelectField label="Provider" value={filters.provider} options={PROVIDERS}
          onChange={v => { setFilters(f => ({ ...f, provider: v })); setPage(1); }} />
        <SelectField label="Status" value={filters.status} options={STATUSES}
          onChange={v => { setFilters(f => ({ ...f, status: v })); setPage(1); }} />
        {(filters.action || filters.provider || filters.status) && (
          <button
            onClick={() => { setFilters({ action: '', provider: '', status: '' }); setPage(1); }}
            className="text-xs text-violet-600 hover:underline ml-1"
          >Clear</button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">When</th>
                <th className="px-3 py-2 text-left font-semibold">Action</th>
                <th className="px-3 py-2 text-left font-semibold">Provider</th>
                <th className="px-3 py-2 text-left font-semibold">Model</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Tokens</th>
                <th className="px-3 py-2 text-right font-semibold">Cost</th>
                <th className="px-3 py-2 text-right font-semibold">Latency</th>
                <th className="px-3 py-2 text-left font-semibold hidden md:table-cell">User</th>
                <th className="px-3 py-2 text-center font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                  <Sparkles className="w-5 h-5 mx-auto mb-2 animate-pulse" />Loading…
                </td></tr>
              )}
              {!loading && data?.rows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">
                  No AI activity yet. Try the AI Hub to make your first call.
                </td></tr>
              )}
              {data?.rows.map(row => (
                <tr key={row.id} className="border-t border-border/50 hover:bg-accent/30 transition-colors">
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    <Clock className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                    {fmtRelative(row.created_at)}
                  </td>
                  <td className="px-3 py-2 font-medium">{row.action}</td>
                  <td className="px-3 py-2">
                    <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                      PROVIDER_COLORS[row.provider] ?? 'bg-muted text-muted-foreground')}>
                      {row.provider}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{row.model ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                      STATUS_COLORS[row.status] ?? 'bg-muted text-muted-foreground')}>
                      {row.status}
                    </span>
                    {row.error_message && (
                      <span className="block text-xs text-red-600 dark:text-red-400 mt-0.5 max-w-xs truncate" title={row.error_message}>
                        {row.error_message}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{(row.tokens_used ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtCost(row.cost_cents ?? 0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.latency_ms ? `${row.latency_ms}ms` : '—'}</td>
                  <td className="px-3 py-2 hidden md:table-cell text-xs text-muted-foreground truncate max-w-[140px]">
                    {row.user_name || row.user_email || '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.status === 'success' && (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => rate(row.id, true)}
                          aria-label="Mark accepted"
                          className={cn('p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition-colors',
                            row.accepted === true && 'text-emerald-600')}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => rate(row.id, false)}
                          aria-label="Mark rejected"
                          className={cn('p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors',
                            row.accepted === false && 'text-red-600')}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data && data.pagination.total > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/50 text-xs text-muted-foreground">
            <span>Page {data.pagination.page} of {data.pagination.pageCount} · {data.pagination.total} total</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
              ><ChevronLeft className="w-4 h-4" /></button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page >= data.pagination.pageCount}
                className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed"
              ><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border-2 border-border/80 bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">{label}</p>
      <p className="text-3xl font-black mt-1 tabular-nums text-black dark:text-white">{value}</p>
      {hint && <p className="text-[10px] font-medium text-muted-foreground/60 mt-1">{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-card border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500"
      >
        {options.map(o => <option key={o} value={o}>{o || 'all'}</option>)}
      </select>
    </label>
  );
}
