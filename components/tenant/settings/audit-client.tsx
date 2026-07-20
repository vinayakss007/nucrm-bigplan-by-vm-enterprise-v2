'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Shield, Search, User, X, ChevronDown, Download, ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { cn, formatDateTimeShort, formatRelativeTime } from '@/lib/utils';

const ACTION_CFG: Record<string, { color: string; bg: string }> = {
  create:         { color:'text-emerald-700 dark:text-emerald-400', bg:'bg-emerald-50 dark:bg-emerald-950/30' },
  update:         { color:'text-blue-700 dark:text-blue-400',      bg:'bg-blue-50 dark:bg-blue-950/30' },
  delete:         { color:'text-red-700 dark:text-red-400',        bg:'bg-red-50 dark:bg-red-950/30' },
  login:          { color:'text-violet-700 dark:text-violet-400',  bg:'bg-violet-50 dark:bg-violet-950/30' },
  invite:         { color:'text-amber-700 dark:text-amber-400',    bg:'bg-amber-50 dark:bg-amber-950/30' },
  member_removed: { color:'text-red-700 dark:text-red-400',        bg:'bg-red-50 dark:bg-red-950/30' },
  role_change:    { color:'text-blue-700 dark:text-blue-400',      bg:'bg-blue-50 dark:bg-blue-950/30' },
  bulk_assign:    { color:'text-violet-700 dark:text-violet-400',  bg:'bg-violet-50 dark:bg-violet-950/30' },
  merge:          { color:'text-amber-700 dark:text-amber-400',    bg:'bg-amber-50 dark:bg-amber-950/30' },
};

const RESOURCE_TYPES = ['contact','deal','task','company','member','role','api_key','integration','workspace'];
const PAGE_SIZE = 50;

interface FieldChange {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  field_label: string | null;
  old_value: string | null;
  new_value: string | null;
  change_type: string;
  user_name: string | null;
  user_email: string | null;
  created_at: Date | null;
}

interface AuditLogEntry {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
  ip_address: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  old_data: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new_data: any;
  full_name: string | null;
  email: string | null;
  user_id: string | null;
  field_changes: FieldChange[];
}

interface AuditLogResponse {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

function toCSV(logs: AuditLogEntry[]): string {
  const header = 'Timestamp,User,Email,Action,Resource,Resource ID,IP Address,Field Changes\n';
  const rows = logs.map(l => {
    const fieldSummary = (l.field_changes ?? [])
      .map(f => `${f.field_name}: ${f.old_value ?? ''} → ${f.new_value ?? ''}`)
      .join('; ');
    return [
      new Date(l.created_at).toISOString(),
      l.full_name ?? '',
      l.email ?? '',
      l.action,
      l.resource_type ?? '',
      l.resource_id ?? '',
      l.ip_address ?? '',
      fieldSummary,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  }).join('\n');
  return header + rows;
}

function downloadCSV(logs: AuditLogEntry[]) {
  const csv = toCSV(logs);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLogClient() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [actionF, setActionF] = useState('');
  const [resourceF, setResourceF] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));
      if (actionF) params.set('action', actionF);
      if (resourceF) params.set('entity_type', resourceF);
      if (search) params.set('search', search);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo + 'T23:59:59Z');

      const res = await fetch(`/api/tenant/audit?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data: AuditLogResponse = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
    } catch {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, actionF, resourceF, search, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const uniqueActions = useMemo(() => {
    return [...new Set(logs.map(l => l.action?.split('_')[0]))].filter(Boolean).sort();
  }, [logs]);

  const handleExport = useCallback(async () => {
    if (total <= PAGE_SIZE) {
      downloadCSV(logs);
      return;
    }
    const params = new URLSearchParams();
    params.set('limit', '10000');
    params.set('offset', '0');
    if (actionF) params.set('action', actionF);
    if (resourceF) params.set('entity_type', resourceF);
    if (search) params.set('search', search);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo + 'T23:59:59Z');
    const res = await fetch(`/api/tenant/audit?${params}`);
    if (res.ok) {
      const data: AuditLogResponse = await res.json();
      downloadCSV(data.logs);
    }
  }, [logs, total, actionF, resourceF, search, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearch('');
    setActionF('');
    setResourceF('');
    setDateFrom('');
    setDateTo('');
    setPage(0);
  };

  const hasFilters = search || actionF || resourceF || dateFrom || dateTo;
  const inp = "px-3 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5" />Audit Log</h1>
          <p className="text-sm text-muted-foreground">{total} total events</p>
        </div>
        <button onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors">
          <Download className="w-3 h-3" />Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search action or type…"
            className={inp + ' pl-8 w-52'} />
        </div>
        <select value={actionF} onChange={e => { setActionF(e.target.value); setPage(0); }} className={inp}>
          <option value="">All actions</option>
          {uniqueActions.map(a => <option key={a} value={a} className="capitalize">{a}</option>)}
        </select>
        <select value={resourceF} onChange={e => { setResourceF(e.target.value); setPage(0); }} className={inp}>
          <option value="">All resources</option>
          {RESOURCE_TYPES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
          className={inp} title="From date" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
          className={inp} title="To date" />
        {hasFilters && (
          <button onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors">
            <X className="w-3 h-3" />Clear
          </button>
        )}
      </div>

      <div className="admin-card overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : !logs.length ? (
          <div className="py-12 text-center">
            <Shield className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No audit events match your filters</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map(log => {
              const word = log.action?.split('_')[0] ?? 'action';
              const cfg  = ACTION_CFG[log.action] ?? ACTION_CFG[word] ?? { color:'text-muted-foreground', bg:'bg-muted/40' };
              const hasDetail = Boolean(log.old_data || log.new_data || (log.field_changes?.length > 0));
              const isOpen = expanded === log.id;
              return (
                  <div key={log.id} className={cn('hover:bg-accent/20 transition-colors', hasDetail ? 'cursor-pointer' : undefined)}
                  onClick={() => hasDetail && setExpanded(isOpen ? null : log.id)}>
                  <div className="flex items-start gap-3 px-5 py-3">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 mt-0.5 whitespace-nowrap', cfg.bg, cfg.color)}>
                      {log.action?.replace(/_/g,' ')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium capitalize">{log.resource_type ?? '—'}</p>
                        {log.resource_id && (
                          <span className="text-[10px] font-mono text-muted-foreground/60">{log.resource_id?.slice(0,8)}…</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <User className="w-3 h-3 shrink-0" />
                        {log.full_name || log.email || 'System'}
                        {log.ip_address && <span className="text-muted-foreground/50">· {log.ip_address}</span>}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground" title={new Date(log.created_at).toLocaleString()}>
                        {formatRelativeTime(log.created_at)}
                      </p>
                      <p className="text-[10px] text-muted-foreground/40">{formatDateTimeShort(log.created_at)}</p>
                    </div>
                    {hasDetail && (
                      <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform', isOpen && 'rotate-180')} />
                    )}
                  </div>
                  {isOpen && hasDetail && (
                    <div className="px-5 pb-3 space-y-3">
                      {/* Field-level diffs */}
                      {log.field_changes?.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground mb-2">Field Changes</p>
                          <div className="space-y-1.5">
                            {log.field_changes.map((fc) => (
                              <div key={fc.id} className="flex items-center gap-2 text-xs">
                                <span className="font-medium text-foreground min-w-[120px] shrink-0">
                                  {fc.field_label ?? fc.field_name}
                                </span>
                                <span className="text-red-600 dark:text-red-400 line-through font-mono text-[10px]">
                                  {fc.old_value ?? '—'}
                                </span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                                  {fc.new_value ?? '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Raw JSON diffs */}
                      {(log.old_data || log.new_data) && (
                        <div className="grid grid-cols-2 gap-3">
                          {log.old_data && (
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Before (Raw)</p>
                              <pre className="text-[10px] font-mono bg-muted/40 rounded-lg p-2 overflow-x-auto text-muted-foreground">{JSON.stringify(log.old_data, null, 2)}</pre>
                            </div>
                          )}
                          {log.new_data && (
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">After (Raw)</p>
                              <pre className="text-[10px] font-mono bg-muted/40 rounded-lg p-2 overflow-x-auto text-muted-foreground">{JSON.stringify(log.new_data, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages} · {total} events
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-1.5 rounded-lg border border-border disabled:opacity-30 hover:bg-accent transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="p-1.5 rounded-lg border border-border disabled:opacity-30 hover:bg-accent transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
