'use client';
import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCheck, Filter, RefreshCw, X, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const LEVEL_CFG: Record<string,{badge:string;dot:string}> = {
  fatal: { badge:'bg-red-500/20 text-red-400', dot:'bg-red-500' },
  error: { badge:'bg-orange-500/20 text-orange-400', dot:'bg-orange-500' },
  warn:  { badge:'bg-amber-500/20 text-amber-400', dot:'bg-amber-400' },
  info:  { badge:'bg-blue-500/20 text-blue-400', dot:'bg-blue-400' },
};

export default function ErrorsPage() {
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [level, setLevel]   = useState('');
  const [resolved, setResolved] = useState('false');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string|null>(null);
  const [resolving, setResolving] = useState<string|null>(null);

  const load = async () => {
    const q = new URLSearchParams({ resolved });
    if (level) q.set('level', level);
    const res = await fetch('/api/superadmin/errors?' + q);
    const d = await res.json();
    setData(d); setLoading(false);
  };
  useEffect(() => { load(); }, [level, resolved]);

  const resolve = async (id?: string, resolveAll?: boolean, lvl?: string) => {
    if (id) setResolving(id);
    await fetch('/api/superadmin/errors', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, resolveAll, level: lvl }),
    });
    toast.success(resolveAll ? 'All resolved' : 'Marked resolved');
    setResolving(null);
    load();
  };

  const s = data?.summary ?? {};
  const errors = (data?.errors ?? []).filter((e: any) =>
    !search || e.message?.toLowerCase()?.includes(search.toLowerCase()) || e.code?.toLowerCase()?.includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-400"/>Error Logs</h1>
          <p className="text-xs text-white/30">Application errors, API failures, and exceptions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 rounded-lg border border-white/10 text-white/30 hover:text-white transition-colors"><RefreshCw className="w-3.5 h-3.5"/></button>
          {resolved==='false' && (
            <button onClick={() => { if(confirm('Mark all unresolved errors as resolved?')) resolve(undefined, true); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-xs font-medium hover:bg-emerald-600/30 transition-colors">
              <CheckCheck className="w-3.5 h-3.5"/>Resolve All
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label:'Fatal', value:s.fatal_unresolved??0, color:'text-red-400', bg:'bg-red-500/10', filter:'fatal' },
          { label:'Error', value:s.error_unresolved??0, color:'text-orange-400', bg:'bg-orange-500/10', filter:'error' },
          { label:'Warn', value:s.warn_unresolved??0, color:'text-amber-400', bg:'bg-amber-500/10', filter:'warn' },
          { label:'Last hour', value:s.last_hour??0, color:'text-white/60', bg:'bg-white/5', filter:'' },
          { label:'Last 24h', value:s.last_day??0, color:'text-white/60', bg:'bg-white/5', filter:'' },
        ].map(m => (
          <button key={m.label} onClick={()=>m.filter&&setLevel(level===m.filter?'':m.filter)}
            className={cn('rounded-xl border border-white/10 p-3 text-left transition-all',m.bg,level===m.filter&&'border-white/20')}>
            <p className="text-xs text-white/40">{m.label}</p>
            <p className={cn('text-xl font-bold mt-0.5',m.color)}>{m.value}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search errors..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500"/>
        </div>
        <div className="flex rounded-xl border border-white/10 overflow-hidden">
          {[['false','Unresolved'],['true','Resolved'],['','All']].map(([v,l]) => (
            <button key={v} onClick={()=>setResolved(v as string)}
              className={cn('px-3 py-2 text-xs font-medium transition-colors',resolved===v?'bg-white/10 text-white':'text-white/40 hover:text-white')}>{l}</button>
          ))}
        </div>
        {level && <button onClick={()=>setLevel('')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 text-xs text-white/50 hover:text-white"><X className="w-3 h-3"/>Clear filter</button>}
      </div>

      {/* Errors list */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        {loading ? <p className="text-white/30 text-sm p-6 text-center">Loading...</p>
        : !errors.length ? (
          <div className="text-center py-12">
            <CheckCheck className="w-10 h-10 text-emerald-500/40 mx-auto mb-3"/>
            <p className="text-white/40 text-sm">{resolved==='true'?'No resolved errors':'No unresolved errors — system is clean ✓'}</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {errors.map((e: any) => {
              const cfg = LEVEL_CFG[e.level] || LEVEL_CFG['info'];
              if (!cfg) return null;
              const isExpanded = expanded === e.id;
              return (
                <div key={e.id} className="hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-start gap-3 px-5 py-3.5 cursor-pointer" onClick={()=>setExpanded(isExpanded?null:e.id)}>
                    <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', cfg.dot)}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase', cfg.badge)}>{e.level}</span>
                        {e.code && <span className="text-[10px] font-mono text-white/30">{e.code}</span>}
                        {e.tenant_name && <span className="text-[10px] text-white/20">{e.tenant_name}</span>}
                        {e.resolved && <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-full">Resolved</span>}
                      </div>
                      <p className="text-sm text-white/70 mt-1 truncate">{e.message}</p>
                      <p className="text-xs text-white/25 mt-0.5">{formatRelativeTime(e.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!e.resolved && (
                        <button onClick={ev=>{ev.stopPropagation();resolve(e.id);}} disabled={resolving===e.id}
                          className="px-2.5 py-1 rounded-lg border border-emerald-500/20 text-[10px] text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-40">
                          {resolving===e.id?'...':'Resolve'}
                        </button>
                      )}
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-white/20"/> : <ChevronRight className="w-4 h-4 text-white/20"/>}
                    </div>
                  </div>
                  {isExpanded && (e.stack || e.context) && (
                    <div className="px-5 pb-4 space-y-2">
                      {e.stack && (
                        <div>
                          <p className="text-[10px] text-white/30 mb-1 font-semibold uppercase tracking-wide">Stack Trace</p>
                          <pre className="text-[10px] font-mono text-red-400/70 bg-red-500/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{e.stack}</pre>
                        </div>
                      )}
                      {e.context && (
                        <div>
                          <p className="text-[10px] text-white/30 mb-1 font-semibold uppercase tracking-wide">Context</p>
                          <pre className="text-[10px] font-mono text-white/40 bg-white/5 rounded-lg p-3 overflow-x-auto">{JSON.stringify(e.context, null, 2)}</pre>
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
