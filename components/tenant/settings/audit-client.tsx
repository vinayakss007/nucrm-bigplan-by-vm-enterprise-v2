'use client';
import { useState, useMemo } from 'react';
import { Shield, Search, Filter, User, X, ChevronDown } from 'lucide-react';
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

export default function AuditLogClient({ logs }: { logs: any[] }) {
  const [search, setSearch]   = useState('');
  const [actionF, setActionF] = useState('');
  const [resourceF, setResourceF] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => logs.filter(l => {
    if (search && !l.full_name?.toLowerCase().includes(search.toLowerCase()) && !l.email?.toLowerCase().includes(search.toLowerCase()) && !l.action?.includes(search.toLowerCase())) return false;
    if (actionF && !l.action?.startsWith(actionF)) return false;
    if (resourceF && l.resource_type !== resourceF) return false;
    return true;
  }), [logs, search, actionF, resourceF]);

  const uniqueActions = [...new Set(logs.map(l => l.action?.split('_')[0]))].filter(Boolean).sort();

  const inp = "px-3 py-1.5 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5" />Audit Log</h1>
        <p className="text-sm text-muted-foreground">{logs.length} events · {filtered.length} shown</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search user or action…"
            className={inp + ' pl-8 w-52'} />
        </div>
        <select value={actionF} onChange={e => setActionF(e.target.value)} className={inp}>
          <option value="">All actions</option>
          {uniqueActions.map(a => <option key={a} value={a} className="capitalize">{a}</option>)}
        </select>
        <select value={resourceF} onChange={e => setResourceF(e.target.value)} className={inp}>
          <option value="">All resources</option>
          {RESOURCE_TYPES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
        </select>
        {(search || actionF || resourceF) && (
          <button onClick={() => { setSearch(''); setActionF(''); setResourceF(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors">
            <X className="w-3 h-3" />Clear
          </button>
        )}
      </div>

      <div className="admin-card overflow-hidden">
        {!filtered.length ? (
          <div className="py-12 text-center">
            <Shield className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No audit events match your filters</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(log => {
              const word = log.action?.split('_')[0] ?? 'action';
              const cfg  = ACTION_CFG[log.action] ?? ACTION_CFG[word] ?? { color:'text-muted-foreground', bg:'bg-muted/40' };
              const hasDetail = log.old_data || log.new_data;
              const isOpen = expanded === log.id;
              return (
                <div key={log.id} className={cn('hover:bg-accent/20 transition-colors', hasDetail && 'cursor-pointer')}
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
                  {isOpen && (log.old_data || log.new_data) && (
                    <div className="px-5 pb-3 grid grid-cols-2 gap-3">
                      {log.old_data && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground mb-1">Before</p>
                          <pre className="text-[10px] font-mono bg-muted/40 rounded-lg p-2 overflow-x-auto text-muted-foreground">{JSON.stringify(log.old_data, null, 2)}</pre>
                        </div>
                      )}
                      {log.new_data && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground mb-1">After</p>
                          <pre className="text-[10px] font-mono bg-muted/40 rounded-lg p-2 overflow-x-auto text-muted-foreground">{JSON.stringify(log.new_data, null, 2)}</pre>
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
    </div>
  );
}
