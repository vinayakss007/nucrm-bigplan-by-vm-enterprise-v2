'use client';
import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Activity, Clock, Database, Mail, Server, Wifi } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

const STATUS_CFG: Record<string,{icon:any;color:string;bg:string}> = {
  up:       { icon:CheckCircle,  color:'text-emerald-400', bg:'border-emerald-500/20 bg-emerald-500/5' },
  degraded: { icon:AlertTriangle,color:'text-amber-400',   bg:'border-amber-500/20 bg-amber-500/5' },
  down:     { icon:XCircle,      color:'text-red-400',     bg:'border-red-500/20 bg-red-500/5' },
};
const SERVICE_ICONS: Record<string,any> = {
  database:Database, app:Server, email:Mail, storage:Database, schema:Database,
};

export default function HealthPage() {
  const [checks, setChecks] = useState<any[]>([]);
  const [appHealth, setAppHealth] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState<Date|null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const run = async () => {
    setLoading(true);
    const [sa, app] = await Promise.all([
      fetch('/api/superadmin/health').then(r=>r.json()).catch(()=>({checks:[]})),
      fetch('/api/health').then(r=>r.json()).catch(()=>{}),
    ]);
    setChecks(sa.checks||[]); setAppHealth(app);
    setLastRun(new Date()); setLoading(false);
  };

  useEffect(() => {
    run();
    let iv: NodeJS.Timeout;
    if (autoRefresh) iv = setInterval(run, 30_000);
    return () => clearInterval(iv);
  }, [autoRefresh]);

  const allUp = checks.every(c=>c.status==='up') && appHealth?.status==='ok';
  const anyDown = checks.some(c=>c.status==='down') || appHealth?.status==='error';

  const overallStatus = anyDown ? 'down' : allUp ? 'up' : 'degraded';
  const cfg = STATUS_CFG[overallStatus];
  if (!cfg) return null;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-violet-400"/>System Health</h1>
          <p className="text-xs text-white/30">{lastRun ? `Last checked ${formatRelativeTime(lastRun.toISOString())}` : 'Running checks...'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setAutoRefresh(a=>!a)}
            className={cn('px-3 py-1.5 rounded-lg border text-xs transition-colors', autoRefresh?'border-violet-500/30 bg-violet-500/10 text-violet-400':'border-white/10 text-white/30 hover:text-white')}>
            {autoRefresh ? '⏸ Auto-refresh ON' : '▶ Auto-refresh OFF'}
          </button>
          <button onClick={run} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/40 hover:text-white disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', loading&&'animate-spin')}/>Run Checks
          </button>
        </div>
      </div>

      {/* Overall status banner */}
      <div className={cn('flex items-center gap-3 p-4 rounded-xl border', cfg.bg)}>
        <cfg.icon className={cn('w-5 h-5 shrink-0', cfg.color)}/>
        <div>
          <p className={cn('text-sm font-bold', cfg.color)}>
            {overallStatus==='up'?'All Systems Operational':overallStatus==='down'?'System Issues Detected':'Degraded Performance'}
          </p>
          <p className="text-xs text-white/40">
            {checks.length} service{checks.length!==1?'s':''} monitored
            {appHealth && ` · DB latency: ${appHealth.db_latency_ms}ms · Uptime: ${Math.floor((appHealth.uptime_s||0)/3600)}h`}
          </p>
        </div>
      </div>

      {/* Service checks grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* App health (from /api/health) */}
        {appHealth && (
          <div className={cn('rounded-xl border p-4', appHealth.status==='ok'?STATUS_CFG['up']!.bg:STATUS_CFG['down']!.bg)}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Server className={cn('w-4 h-4', appHealth.status==='ok'?'text-emerald-400':'text-red-400')}/>
                <p className="text-sm font-semibold text-white">Application</p>
              </div>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', appHealth.status==='ok'?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400')}>
                {appHealth.status==='ok'?'UP':'DOWN'}
              </span>
            </div>
            <div className="space-y-1 text-xs text-white/40">
              <p>Node {appHealth.node}</p>
              <p>DB latency: <span className="text-white/60">{appHealth.db_latency_ms}ms</span></p>
              <p>Uptime: <span className="text-white/60">{Math.floor((appHealth.uptime_s||0)/3600)}h {Math.floor(((appHealth.uptime_s||0)%3600)/60)}m</span></p>
              <p>Schema: <span className={appHealth.schema_ready!==false?'text-emerald-400':'text-red-400'}>{appHealth.schema_ready!==false?'Ready':'Missing tables'}</span></p>
            </div>
          </div>
        )}

        {/* Service checks from superadmin/health */}
        {checks.map((c:any) => {
          const s = STATUS_CFG[c.status] || STATUS_CFG['up'];
          if (!s) return null;
          const Icon = SERVICE_ICONS[c.service] || Wifi;
          return (
            <div key={c.service} className={cn('rounded-xl border p-4', s.bg)}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={cn('w-4 h-4', s.color)}/>
                  <p className="text-sm font-semibold text-white capitalize">{c.service}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c.latency_ms > 0 && <span className="text-[10px] text-white/30">{c.latency_ms}ms</span>}
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase', c.status==='up'?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400')}>
                    {c.status}
                  </span>
                </div>
              </div>
              {c.message && <p className="text-xs text-white/40">{c.message}</p>}
            </div>
          );
        })}

        {/* Schema check */}
        {appHealth?.missing_tables?.length > 0 && (
          <div className={cn('rounded-xl border p-4 sm:col-span-2', STATUS_CFG['down']!.bg)}>
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-red-400"/>
              <p className="text-sm font-semibold text-white">Missing Database Tables</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {appHealth.missing_tables.map((t:string) => (
                <span key={t} className="text-[10px] font-mono bg-red-500/10 text-red-400 px-2 py-0.5 rounded">{t}</span>
              ))}
            </div>
            <p className="text-xs text-red-400/60 mt-2">Run: <code className="font-mono">npm run db:push</code></p>
          </div>
        )}
      </div>

      {/* Run manual checks */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-semibold text-white mb-3">Manual Operations</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label:'Run Cleanup', action:async()=>{ await fetch('/api/cron/cleanup',{method:'POST',headers:{'x-cron-secret':''}}); alert('Cleanup triggered'); } },
            { label:'Check Backup Health', action:async()=>{ const r=await fetch('/api/cron/backup-health',{method:'POST',headers:{'x-cron-secret':''}}); const d=await r.json(); alert(JSON.stringify(d,null,2)); } },
            { label:'Take Usage Snapshot', action:async()=>{ await fetch('/api/cron/usage-snapshot',{method:'POST',headers:{'x-cron-secret':''}}); alert('Snapshot taken'); } },
          ].map(a => (
            <button key={a.label} onClick={a.action}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/40 hover:text-white hover:border-white/20 transition-colors">
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
