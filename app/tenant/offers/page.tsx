'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  FileText, Send, Eye, CheckCircle2, XCircle, Clock, AlertCircle, Search,
  ChevronLeft, ChevronRight, RefreshCw, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type OfferRow = {
  id: string;
  quote_number: string | null;
  title: string;
  status: string;
  total_amount: string | number;
  expires_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  contact_id: string | null;
  contact_name: string;
  contact_email: string | null;
  created_at: string;
  public_token: string | null;
  sent_to_email: string | null;
  viewed_count: number;
};

type Resp = {
  offers: OfferRow[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  summary: Record<string, { count: number; amount: number }>;
};

const STATUSES: { id: string; label: string; icon: typeof FileText; tone: string }[] = [
  { id: '',          label: 'All',       icon: FileText,    tone: 'bg-muted text-foreground' },
  { id: 'draft',     label: 'Draft',     icon: FileText,    tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  { id: 'sent',      label: 'Sent',      icon: Send,        tone: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  { id: 'viewed',    label: 'Viewed',    icon: Eye,         tone: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
  { id: 'accepted',  label: 'Accepted',  icon: CheckCircle2,tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  { id: 'declined',  label: 'Declined',  icon: XCircle,     tone: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  { id: 'expired',   label: 'Expired',   icon: Clock,       tone: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
];

function fmtCurrency(amt: string | number): string {
  const n = typeof amt === 'string' ? parseFloat(amt) : amt;
  if (!isFinite(n)) return '$0';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function OffersListPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('pageSize', '25');
    if (statusFilter) p.set('status', statusFilter);
    return p.toString();
  }, [page, statusFilter]);

  function load() {
    setLoading(true);
    setError(null);
    fetch(`/api/tenant/offers?${qs}`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }
  useEffect(load, [qs]);

  const filteredOffers = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data.offers;
    const q = search.toLowerCase();
    return data.offers.filter(o =>
      o.title.toLowerCase().includes(q) ||
      (o.quote_number ?? '').toLowerCase().includes(q) ||
      (o.contact_name ?? '').toLowerCase().includes(q) ||
      (o.contact_email ?? '').toLowerCase().includes(q)
    );
  }, [data, search]);

  const summary = data?.summary ?? {};
  const totalAccepted = summary['accepted']?.amount ?? 0;
  const totalSent = (summary['sent']?.amount ?? 0) + (summary['viewed']?.amount ?? 0);

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shrink-0">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">Offers</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Customer-facing wrapper around your quotes. Send the buyer a public link and track open / accept / decline.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent text-sm transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
        <Link
          href="/tenant/quotes/new"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New offer
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Drafts"     value={summary['draft']?.count ?? 0}    hint={fmtCurrency(summary['draft']?.amount ?? 0)} />
        <Stat label="Awaiting"   value={(summary['sent']?.count ?? 0) + (summary['viewed']?.count ?? 0)} hint={fmtCurrency(totalSent)} />
        <Stat label="Accepted"   value={summary['accepted']?.count ?? 0} hint={fmtCurrency(totalAccepted)} tone="emerald" />
        <Stat label="Declined"   value={summary['declined']?.count ?? 0} hint={fmtCurrency(summary['declined']?.amount ?? 0)} tone="red" />
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2.5">
        {STATUSES.map(s => {
          const Icon = s.icon;
          const active = statusFilter === s.id;
          const count = s.id ? (summary[s.id]?.count ?? 0) : Object.values(summary).reduce((a, b) => a + b.count, 0);
          return (
            <button
              key={s.id || 'all'}
              onClick={() => { setStatusFilter(s.id); setPage(1); }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                active ? 'bg-violet-600 text-white' : 'hover:bg-accent'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {s.label}
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold', active ? 'bg-white/20' : 'bg-muted-foreground/10')}>
                {count}
              </span>
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, number, buyer…"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
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
                <th className="px-3 py-2 text-left font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">Title</th>
                <th className="px-3 py-2 text-left font-semibold">Buyer</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold hidden md:table-cell">Sent</th>
                <th className="px-3 py-2 text-center font-semibold hidden md:table-cell">Views</th>
                <th className="px-3 py-2 text-left font-semibold hidden lg:table-cell">Expires</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                  <FileText className="w-5 h-5 mx-auto mb-2 animate-pulse" />Loading…
                </td></tr>
              )}
              {!loading && filteredOffers.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                  No offers yet. Create a quote and send it to a buyer.
                </td></tr>
              )}
              {filteredOffers.map(o => (
                <tr key={o.id} className="border-t border-border/50 hover:bg-accent/30 transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {o.quote_number ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/tenant/offers/${o.id}`} className="hover:text-violet-600 hover:underline">
                      {o.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {o.contact_name || o.contact_email || o.sent_to_email || '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {fmtCurrency(o.total_amount)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap hidden md:table-cell">
                    {fmtRelative(o.sent_at)}
                  </td>
                  <td className="px-3 py-2 text-center text-xs tabular-nums hidden md:table-cell">
                    {o.viewed_count ?? 0}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                    {o.expires_at ? new Date(o.expires_at).toLocaleDateString() : '—'}
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

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'emerald' | 'red' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' :
    tone === 'red'     ? 'text-red-700 dark:text-red-400' :
                         'text-black dark:text-white';
  return (
    <div className="rounded-xl border-2 border-border/80 bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">{label}</p>
      <p className={cn('text-3xl font-black mt-1 tabular-nums', toneClass)}>{value}</p>
      {hint && <p className="text-[10px] font-medium text-muted-foreground/60 mt-1 tabular-nums">{hint}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUSES.find(s => s.id === status) ?? { label: status, tone: 'bg-muted text-foreground', icon: FileText };
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider', cfg.tone)}>
      <Icon className="w-3 h-3" />
      {cfg.label || status}
    </span>
  );
}
