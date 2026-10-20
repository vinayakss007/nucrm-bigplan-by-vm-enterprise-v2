/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';
import Link from 'next/link';
import {
  ShieldCheck, Check, X, AlertCircle, RefreshCw, Filter, ExternalLink,
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
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  // The strip that used to carry both now carries only a refused decision. A read failure
  // is not an action failure: the two answer different questions and, above all, the
  // operator's next move is different — retry the read, or fix the payload and try again.
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<Row | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('status', filter);
    p.set('limit', '50');
    return p.toString();
  }, [filter]);

  // #1328: approvals via TanStack Query (was raw fetch + useEffect). filter/qs is
  // part of the key so each view refetches and caches.
  const { data, isLoading: loading, isFetching, error: queryError, refetch } = useApiQuery<Resp>(
    ['tenant', 'approvals', qs],
    `/api/tenant/approvals?${qs}`,
  );
  // #2872: this single flag was answering two different questions, and both answers lied.
  // Approve/Reject invalidate ['tenant','approvals'] below and the rows are gated on `data`
  // rather than on the flag, so when that refresh was refused TanStack Query handed back the
  // payload the view already had: the queue stayed on screen while the strip above it said it
  // could not be loaded. The other half is the one a manager acts on. After a read that never
  // answered, `data?.summary` is unset, so the three cards reported Pending 0 · Approved 0 ·
  // Rejected 0 and every filter chip carried a count of 0 — and `summary` is not the view's
  // tally, it is the tenant's totals per status over every row regardless of the status filter
  // (app/api/tenant/approvals/route.ts:88-95 groups on status with only the tenant clause,
  // while `rows` at :55-56 honours the filter). "0 pending" from an unread request therefore
  // claims nobody is waiting on this approver. #2829's dash-instead-of-zero discipline covers
  // the money panels whose figures come off a rendered array; this page's come from the
  // server's `summary`, so the sweep never reached it and there was no outage copy here to
  // preserve — the bare flag printed the raw `queryError.message`. The copy below is that
  // established shape, and only its gating changes.
  const failed = Boolean(queryError) && !data;   // read never answered → outage copy, no figures
  const stale = Boolean(queryError) && Boolean(data); // answered before, refresh refused → keep everything
  const reason = queryError?.message || 'no response from the server';
  const error = failed ? `Failed to load approvals: ${reason}` : null;
  const load = () => refetch();

  const decideMutation = useMutation({
    // `note`, not `reason`: the read's `reason` above is the failure the banner names, and
    // shadowing it inside the mutation would make the two failure kinds easy to confuse.
    mutationFn: async ({ row, action, reason: note }: { row: Row; action: 'approve' | 'reject'; reason?: string }) => {
      const res = await fetch(`/api/tenant/approvals/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason: note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    },
    onMutate: () => setMutationError(null),
    onSuccess: () => {
      setRejectModal(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['tenant', 'approvals'] });
    },
    onError: (e: Error) => setMutationError(e.message),
  });
  const busyId = decideMutation.isPending ? (decideMutation.variables?.row.id ?? null) : null;
  function decide(row: Row, action: 'approve' | 'reject', note?: string) {
    decideMutation.mutate({ row, action, reason: note });
  }

  // Reached only where a figure is not dashed, i.e. only once the read has answered: on a
  // failed read every site below prints '—' instead of consulting this, so the zeros never
  // stand in for numbers that were never read.
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
          onClick={() => load()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stats — dashed, never zeroed, when the read never answered (see the #2872 note above) */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Pending" value={failed ? '—' : summary.pending} tone="amber" />
        <Stat label="Approved" value={failed ? '—' : summary.approved} tone="emerald" />
        <Stat label="Rejected" value={failed ? '—' : summary.rejected} tone="red" />
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5">
        <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
        {FILTERS.map(f => {
          const active = filter === f.id;
          // The chip stays clickable after a failed read — clicking it is the way out of the
          // view the operator is stuck in. Only the count it prints is dashed, because a 0
          // here offers four filters that would each answer "none" about a queue that was
          // never read.
          const count = failed ? '—' : f.id === 'all'
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

      {mutationError && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800/50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{mutationError}</span>
        </div>
      )}

      {stale && (
        // Refused refresh, kept queue. The Approve/Reject buttons stay live on purpose: the
        // PATCH re-reads the row by id and tenant before it decides anything
        // (app/api/tenant/approvals/[id]/route.ts:57-62), 404s when that read finds nothing
        // (:63-65), and refuses a decision on a row that is no longer pending with a 409
        // naming its real status (:66-70), then takes a concurrency guard on the row's
        // updated_at (:73). So deciding a stale row is answered by the server with the truth
        // rather than applied twice on a guess — which is why this banner warns instead of
        // disabling. What the read being old does cost is named here: a request another admin
        // has since decided still shows as pending, and the three figures are tenant-wide
        // totals, so the workload they describe is the one from before the refusal.
        <InlineErrorState
          message={`Could not refresh, so the approvals below, the three figures and the chip counts are the last read: ${reason}. A request another admin approved or rejected since this was fetched is still listed here as pending with its decision buttons live, and Pending/Approved/Rejected are the older tenant-wide totals.`}
          onRetry={load}
        />
      )}

      {error && (
        <InlineErrorState message={error} onRetry={load} />
      )}

      {/* Cards */}
      <div className="space-y-3">
        {loading && !data && (
          <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
            <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />Loading…
          </div>
        )}
        {/* Gated on `data`, not on the read flags: "no pending approval requests" is a claim
            about the tenant that only an answered read may make, and an outage has no data at
            all — so the outage card above is what the operator sees, never this. A kept-but-
            stale empty queue does say it, with the caveat over it. */}
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

function Stat({ label, value, tone }: { label: string; value: number | string; tone: 'amber' | 'emerald' | 'red' }) {
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
