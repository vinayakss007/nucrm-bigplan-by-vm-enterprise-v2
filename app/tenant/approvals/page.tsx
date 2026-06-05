'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, Check, X, Clock, AlertCircle, RefreshCw, Filter, ExternalLink,
  Loader2, FileText, Users, Building2, TrendingUp, CheckSquare, LifeBuoy,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Row = {
  id: string;
  entity_type: string;
  entity_id: string;
  rule_id: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  requested_at: string;
  decided_at: string | null;
  requested_by_id: string | null;
  requested_by_name: string | null;
  requested_by_email: string | null;
  decided_by_name: string | null;
};

type Resp = {
  rows: Row[];
  pagination: { limit: number; offset: number; total: number };
  summary: { pending: number; approved: number; rejected: number };
};

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

const ENTITY_ICONS: Record<string, typeof FileText> = {
  contact:  Users,
  company:  Building2,
  deal:     TrendingUp,
  task:     CheckSquare,
  ticket:   LifeBuoy,
  quote:    FileText,
  offer:    FileText,
};

const ENTITY_HREFS: Record<string, (id: string) => string> = {
  contact: id => `/tenant/contacts/${id}`,
  company: id => `/tenant/companies/${id}`,
  deal:    id => `/tenant/deals/${id}`,
  task:    id => `/tenant/tasks/${id}`,
  ticket:  id => `/tenant/tickets/${id}`,
  quote:   id => `/tenant/offers/${id}`,
  offer:   id => `/tenant/offers/${id}`,
};

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

const FILTERS: { id: 'pending' | 'approved' | 'rejected' | 'all'; label: string }[] = [
  { id: 'pending',  label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all',      label: 'All' },
];

export default function ApprovalsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<Row | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('status', filter);
    p.set('limit', '50');
    return p.toString();
  }, [filter]);

  function load() {
    setLoading(true);
    setError(null);
    fetch(`/api/tenant/approvals?${qs}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [qs]);

  async function decide(row: Row, action: 'approve' | 'reject', reason?: string) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/approvals/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRejectModal(null);
      setRejectReason('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const summary = data?.summary ?? { pending: 0, approved: 0, rejected: 0 };

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shrink-0">
          <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Review and decide on approval requests for sensitive changes — high-value deals, large refunds, role changes, bulk transfers.
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

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Pending" value={summary.pending} tone="amber" />
        <Stat label="Approved" value={summary.approved} tone="emerald" />
        <Stat label="Rejected" value={summary.rejected} tone="red" />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5">
        <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
        {FILTERS.map(f => {
          const active = filter === f.id;
          const count = f.id === 'all'
            ? summary.pending + summary.approved + summary.rejected
            : summary[f.id];
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                active ? 'bg-violet-600 text-white' : 'hover:bg-accent'
              )}
            >
              {f.label}
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold', active ? 'bg-white/20' : 'bg-muted-foreground/10')}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Cards */}
      <div className="space-y-3">
        {loading && !data && (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
            <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />Loading…
          </div>
        )}
        {!loading && data && data.rows.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
            <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium">No {filter === 'all' ? '' : filter} approval requests.</p>
            <p className="text-xs mt-1">Approval rules trigger requests automatically when a sensitive change happens.</p>
          </div>
        )}
        {data?.rows.map(row => {
          const Icon = ENTITY_ICONS[row.entity_type] ?? FileText;
          const href = ENTITY_HREFS[row.entity_type]?.(row.entity_id);
          const isPending = row.status === 'pending';
          return (
            <div key={row.id} className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{row.entity_type}</span>
                  <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', STATUS_COLORS[row.status])}>
                    {row.status}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground/60 truncate" title={row.rule_id}>
                    Rule: {row.rule_id}
                  </span>
                </div>
                <p className="text-sm">
                  Requested by <span className="font-semibold">{row.requested_by_name ?? row.requested_by_email ?? 'unknown'}</span>
                  {' · '}
                  <span className="text-muted-foreground">{fmtRelative(row.requested_at)}</span>
                </p>
                {row.status !== 'pending' && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
                    <span className="font-medium">{row.decided_by_name ?? '—'}</span>{' '}
                    {fmtRelative(row.decided_at)}
                    {row.reason && <> · {row.reason}</>}
                  </p>
                )}
                {href && (
                  <Link href={href} className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline mt-1">
                    Open record <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>
              {isPending && (
                <div className="flex items-center gap-2 sm:flex-col sm:items-stretch sm:w-32 shrink-0">
                  <button
                    onClick={() => decide(row, 'approve')}
                    disabled={busyId === row.id}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    {busyId === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Approve
                  </button>
                  <button
                    onClick={() => { setRejectModal(row); setRejectReason(''); }}
                    disabled={busyId === row.id}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 dark:border-red-800/50 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 text-xs font-semibold disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reject modal */}
      {rejectModal && (
        <div
          className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setRejectModal(null)}
        >
          <div
            className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-md p-5 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Reject approval request</h2>
              <button onClick={() => setRejectModal(null)} className="p-1 rounded hover:bg-accent" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              Rejecting "{rejectModal.entity_type}" requested by{' '}
              <span className="font-medium">{rejectModal.requested_by_name ?? rejectModal.requested_by_email}</span>.
            </p>
            <label className="block text-sm">
              <span className="block text-xs font-semibold text-muted-foreground mb-1">Reason (required)</span>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Explain why this is being rejected so the requester learns from it."
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-1 focus:ring-violet-500"
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRejectModal(null)}
                className="px-3 py-2 rounded-lg border border-border hover:bg-accent text-sm"
              >Cancel</button>
              <button
                onClick={() => decide(rejectModal, 'reject', rejectReason.trim())}
                disabled={!rejectReason.trim() || busyId === rejectModal.id}
                className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-1.5"
              >
                {busyId === rejectModal.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'emerald' | 'red' }) {
  const toneClass =
    tone === 'amber'   ? 'text-amber-700 dark:text-amber-400' :
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' :
                         'text-red-700 dark:text-red-400';
  return (
    <div className="rounded-xl border-2 border-border/80 bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">{label}</p>
      <p className={cn('text-3xl font-black mt-1 tabular-nums', toneClass)}>{value}</p>
    </div>
  );
}
