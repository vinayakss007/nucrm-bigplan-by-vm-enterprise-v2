/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Shield, Search, User, X, ChevronDown, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, formatDateTimeShort, formatRelativeTime } from '@/lib/utils';

const ACTION_CFG: Record<string, { color: string; bg: string }> = {
  'tenant.created':          { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  'tenant.suspended':        { color: 'text-red-700 dark:text-red-400',        bg: 'bg-red-50 dark:bg-red-950/30' },
  'tenant.deleted':          { color: 'text-red-700 dark:text-red-400',        bg: 'bg-red-50 dark:bg-red-950/30' },
  'tenant.plan_changed':     { color: 'text-blue-700 dark:text-blue-400',      bg: 'bg-blue-50 dark:bg-blue-950/30' },
  'tenant.settings_changed': { color: 'text-blue-700 dark:text-blue-400',      bg: 'bg-blue-50 dark:bg-blue-950/30' },
  'user.impersonation_started': { color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/30' },
  'user.impersonation_ended':   { color: 'text-violet-700 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/30' },
  'role.updated':            { color: 'text-amber-700 dark:text-amber-400',    bg: 'bg-amber-50 dark:bg-amber-950/30' },
  'settings.changed':        { color: 'text-blue-700 dark:text-blue-400',      bg: 'bg-blue-50 dark:bg-blue-950/30' },
  'subscription.plan_changed': { color: 'text-blue-700 dark:text-blue-400',    bg: 'bg-blue-50 dark:bg-blue-950/30' },
  'backup.created':          { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  'restore.executed':        { color: 'text-amber-700 dark:text-amber-400',    bg: 'bg-amber-50 dark:bg-amber-950/30' },
  'billing.overridden':      { color: 'text-violet-700 dark:text-violet-400',  bg: 'bg-violet-50 dark:bg-violet-950/30' },
  'api_key.created':         { color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  'api_key.revoked':         { color: 'text-red-700 dark:text-red-400',        bg: 'bg-red-50 dark:bg-red-950/30' },
};

const TARGET_TYPES = ['tenant', 'user', 'subscription', 'settings', 'backup', 'restore', 'api_key', 'role', 'module', 'announcement'];
const PAGE_SIZE = 50;

interface AuditLogEntry {
  id: string;
  admin_id: string;
  admin_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  old_data: string | null;
  new_data: string | null;
  metadata: string | null;
  previous_hash: string | null;
  hash: string;
  created_at: string;
}

interface AuditLogResponse {
  data: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

function toCSV(logs: AuditLogEntry[]): string {
  const header = 'Timestamp,Admin Email,Action,Target Type,Target ID,Target Name,Tenant,IP Address\n';
  const rows = logs.map(l =>
    [
      new Date(l.created_at).toISOString(),
      l.admin_email ?? '',
      l.action,
      l.target_type ?? '',
      l.target_id ?? '',
      l.target_name ?? '',
      l.tenant_name ?? '',
      l.ip_address ?? '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  return header + rows;
}

function downloadCSV(logs: AuditLogEntry[]) {
  const csv = toCSV(logs);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `superadmin-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function parseJsonSafe(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export default function AuditLogClient() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [actionF, setActionF] = useState('');
  const [targetF, setTargetF] = useState('');
  const [tenantSearch, setTenantSearch] = useState('');
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
      if (targetF) params.set('target_type', targetF);
      if (search) params.set('search', search);
      if (tenantSearch) params.set('tenant_id', tenantSearch);
      if (dateFrom) params.set('start_date', dateFrom);
      if (dateTo) params.set('end_date', dateTo + 'T23:59:59Z');

      const res = await fetch(`/api/super-admin/audit-logs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data: AuditLogResponse = await res.json();
      setLogs(data.data);
      setTotal(data.total);
    } catch {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, actionF, targetF, search, tenantSearch, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const uniqueActions = useMemo(() => {
    return [...new Set(logs.map(l => l.action))].filter(Boolean).sort();
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
    if (targetF) params.set('target_type', targetF);
    if (search) params.set('search', search);
    if (tenantSearch) params.set('tenant_id', tenantSearch);
    if (dateFrom) params.set('start_date', dateFrom);
    if (dateTo) params.set('end_date', dateTo + 'T23:59:59Z');
    const res = await fetch(`/api/super-admin/audit-logs?${params}`);
    if (res.ok) {
      const data: AuditLogResponse = await res.json();
      downloadCSV(data.data);
    }
  }, [logs, total, actionF, targetF, search, tenantSearch, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearch('');
    setActionF('');
    setTargetF('');
    setTenantSearch('');
    setDateFrom('');
    setDateTo('');
    setPage(0);
  };

  const hasFilters = search || actionF || targetF || tenantSearch || dateFrom || dateTo;
  const inp = "px-3 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-amber-500";

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5" />Super Admin Audit Log</h1>
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
          {uniqueActions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={targetF} onChange={e => { setTargetF(e.target.value); setPage(0); }} className={inp}>
          <option value="">All targets</option>
          {TARGET_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
        <input value={tenantSearch} onChange={e => { setTenantSearch(e.target.value); setPage(0); }}
          placeholder="Tenant ID…"
          className={inp + ' w-36'} />
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
              const cfg = ACTION_CFG[log.action] ?? { color: 'text-muted-foreground', bg: 'bg-muted/40' };
              const hasDetail = Boolean(log.old_data || log.new_data);
              const isOpen = expanded === log.id;
              const oldParsed = parseJsonSafe(log.old_data) as Record<string, unknown> | string | null;
              const newParsed = parseJsonSafe(log.new_data) as Record<string, unknown> | string | null;
              return (
                <div key={log.id} className={cn('hover:bg-accent/20 transition-colors', hasDetail ? 'cursor-pointer' : undefined)}
                  onClick={() => hasDetail && setExpanded(isOpen ? null : log.id)}>
                  <div className="flex items-start gap-3 px-5 py-3">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide shrink-0 mt-0.5 whitespace-nowrap', cfg.bg, cfg.color)}>
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium capitalize">{log.target_type ?? '—'}</p>
                        {log.target_name && (
                          <span className="text-xs text-muted-foreground">{log.target_name}</span>
                        )}
                        {log.target_id && (
                          <span className="text-[10px] font-mono text-muted-foreground/60">{log.target_id.slice(0, 8)}…</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <User className="w-3 h-3 shrink-0" />
                        {log.admin_email}
                        {log.tenant_name && <span className="text-muted-foreground/50">· {log.tenant_name}</span>}
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
                    <div className="px-5 pb-3 grid grid-cols-2 gap-3">
                      {oldParsed && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground mb-1">Before</p>
                          <pre className="text-[10px] font-mono bg-muted/40 rounded-lg p-2 overflow-x-auto text-muted-foreground max-h-48 overflow-y-auto">{JSON.stringify(oldParsed, null, 2)}</pre>
                        </div>
                      )}
                      {newParsed && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground mb-1">After</p>
                          <pre className="text-[10px] font-mono bg-muted/40 rounded-lg p-2 overflow-x-auto text-muted-foreground max-h-48 overflow-y-auto">{JSON.stringify(newParsed, null, 2)}</pre>
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
