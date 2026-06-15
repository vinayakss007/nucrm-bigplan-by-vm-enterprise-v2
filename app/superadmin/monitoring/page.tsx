'use client';
import { useState, useEffect } from 'react';
import {
  Activity, AlertTriangle, CheckCircle, RefreshCw, Building2, Users,
  DollarSign, Database, Clock, TrendingUp, Zap, Server, Book,
} from 'lucide-react';
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const CHART_STYLE = { background:'transparent' };
const TICK_STYLE  = { fill:'rgba(255,255,255,0.3)', fontSize:10 };
const TIP_STYLE   = { background:'hsl(222,32%,9%)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, fontSize:11 };

export default function MonitoringPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData]         = useState<any>(null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [health, setHealth]     = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const load = async () => {
    const [mon, hlt] = await Promise.all([
      fetch('/api/superadmin/monitoring').then(r => r.ok ? r.json() : {}),
      fetch('/api/health').then(r=>r.json()),
    ]);
    setData(mon); setHealth(hlt);
    setLastRefresh(new Date()); setLoading(false); setRefreshing(false);
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  const s  = data?.stats ?? {};
  const hs = health ?? {};
  const allUp = hs.status==='ok';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Metric = ({ label, value, icon:Icon, color, sub }:any) => (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-white/40">{label}</p>
        <Icon className={cn('w-4 h-4',color)}/>
      </div>
      <p className={cn('text-2xl font-bold text-white',color)}>{value}</p>
      {sub&&<p className="text-xs text-white/30 mt-1">{sub}</p>}
    </div>
  );

  const ServiceBadge = ({ name, ok, latency }:{name:string;ok:boolean;latency?:number}) => (
    <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border',ok?'border-emerald-500/20 bg-emerald-500/5':'border-red-500/20 bg-red-500/5')}>
      <div className={cn('w-2 h-2 rounded-full',ok?'bg-emerald-400':'bg-red-400 animate-pulse')}/>
      <span className="text-xs text-white/60 font-medium capitalize">{name}</span>
      {latency!==undefined&&<span className="text-[10px] text-white/30 ml-auto">{latency}ms</span>}
    </div>
  );

  if (loading) return (
    <div className="flex items-center gap-3 text-white/40 p-4">
      <RefreshCw className="w-4 h-4 animate-spin"/>Loading monitoring data...
    </div>
  );

  // Plan distribution
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const planDist = (data?.planDist||[]).map((p:any) => ({
    name: p.name, count: p.tenant_count,
    revenue: Number(p.price_monthly) * Number(p.tenant_count),
  }));

  // Tenant growth — fill missing days
  const growthMap: Record<string,number> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  (data?.tenantGrowth||[]).forEach((d:any) => { growthMap[d.day] = d.count; });
  const last30 = Array.from({length:30},(_,i)=>{
    const d = new Date(); d.setDate(d.getDate()-29+i);
    const key: string = d.toISOString().split('T')[0] ?? '';
    return { day:key.slice(5), count:growthMap[key]||0 };
  });

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-violet-400"/>Platform Monitoring</h1>
          <p className="text-xs text-white/30">Last updated {formatRelativeTime(lastRefresh.toISOString())} · Auto-refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium', allUp?'border-emerald-500/20 bg-emerald-500/5 text-emerald-400':'border-red-500/20 bg-red-500/5 text-red-400')}>
            {allUp?<CheckCircle className="w-3.5 h-3.5"/>:<AlertTriangle className="w-3.5 h-3.5"/>}
            {allUp?'All Systems Operational':'Issues Detected'}
          </div>
          <button onClick={()=>{setRefreshing(true);load();}} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 text-xs text-white/40 hover:text-white transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5',refreshing&&'animate-spin')}/>Refresh
          </button>
        </div>
      </div>

      {/* System health row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ServiceBadge name="Database" ok={hs.db==='connected'} latency={hs.db_latency_ms}/>
        <ServiceBadge name="App Server" ok={true} latency={0}/>
        <ServiceBadge name="Schema" ok={hs.schema_ready!==false}/>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5">
          <Server className="w-3.5 h-3.5 text-white/30"/>
          <span className="text-xs text-white/40">Uptime: <span className="text-white font-medium">{Math.floor((hs.uptime_s||0)/3600)}h {Math.floor(((hs.uptime_s||0)%3600)/60)}m</span></span>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Monthly Revenue" value={formatCurrency(s.mrr??0)} icon={DollarSign} color="text-emerald-400" sub={`ARR: ${formatCurrency((s.mrr??0)*12)}`}/>
        <Metric label="Active Tenants"  value={(s.active_tenants??0).toLocaleString()} icon={Building2} color="text-violet-400"/>
        <Metric label="Total Users"     value={(s.total_users??0).toLocaleString()} icon={Users} color="text-blue-400"/>
        <Metric label="Open Errors (24h)" value={(s.unresolved_errors??0).toString()} icon={AlertTriangle} color={(s.unresolved_errors??0)>0?'text-red-400':'text-white/20'} sub={(s.unresolved_errors??0)>0?'Check error logs':'Clean'}/>
      </div>

      {/* Backup & Restore Status Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Backup Status */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-400"/>Backups
            </p>
            <div className="flex items-center gap-2">
              {(data?.backupStatus?.running || 0) > 0 && (
                <span className="flex items-center gap-1 text-xs text-blue-400">
                  <RefreshCw className="w-3 h-3 animate-spin"/>{(data?.backupStatus?.running || 0)} running
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center p-3 rounded-lg bg-white/5">
              <p className="text-xl font-bold text-white">{data?.backupStatus?.total || 0}</p>
              <p className="text-[10px] text-white/40">Total</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-emerald-500/10">
              <p className="text-xl font-bold text-emerald-400">{data?.backupStatus?.completed || 0}</p>
              <p className="text-[10px] text-white/40">Completed</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-500/10">
              <p className="text-xl font-bold text-red-400">{data?.backupStatus?.failed || 0}</p>
              <p className="text-[10px] text-white/40">Failed</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-500/10">
              <p className="text-xl font-bold text-blue-400">{data?.backupStatus?.running || 0}</p>
              <p className="text-[10px] text-white/40">Running</p>
            </div>
          </div>
        </div>

        {/* Restore Status */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-white flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-violet-400"/>Restore Operations
            </p>
          </div>
          <div className="grid grid-cols-5 gap-2">
            <div className="text-center p-2 rounded-lg bg-white/5">
              <p className="text-lg font-bold text-white">{data?.restoreStatus?.total || 0}</p>
              <p className="text-[10px] text-white/40">Total</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-amber-500/10">
              <p className="text-lg font-bold text-amber-400">{data?.restoreStatus?.pending || 0}</p>
              <p className="text-[10px] text-white/40">Pending</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-blue-500/10">
              <p className="text-lg font-bold text-blue-400">{data?.restoreStatus?.running || 0}</p>
              <p className="text-[10px] text-white/40">Running</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-emerald-500/10">
              <p className="text-lg font-bold text-emerald-400">{data?.restoreStatus?.completed || 0}</p>
              <p className="text-[10px] text-white/40">Done</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-red-500/10">
              <p className="text-lg font-bold text-red-400">{data?.restoreStatus?.failed || 0}</p>
              <p className="text-[10px] text-white/40">Failed</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Backups */}
      {(data?.recentBackups || []).length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">Recent Backups</p>
          <div className="space-y-2">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
            {(data.recentBackups || []).slice(0,5).map((b: any) => (
              <div key={b.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    'px-2 py-0.5 rounded font-medium',
                    b.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                    b.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                    'bg-blue-500/20 text-blue-400'
                  )}>{b.status}</span>
                  <span className="text-white/60">{b.backup_name || 'Backup'}</span>
                </div>
                <div className="flex items-center gap-4 text-white/30">
                  <span>{b.size_bytes ? `${(b.size_bytes / 1024 / 1024).toFixed(1)} MB` : '—'}</span>
                  <span>{formatRelativeTime(b.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Tenant growth */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">New Tenants — Last 30 Days</p>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={last30} style={CHART_STYLE}>
              <defs>
                <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.3}/>
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
              <XAxis dataKey="day" tick={TICK_STYLE} tickLine={false} axisLine={false} interval={4}/>
              <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false}/>
              <Tooltip contentStyle={TIP_STYLE} cursor={{stroke:'rgba(255,255,255,0.1)'}}/>
              <Area type="monotone" dataKey="count" stroke="#7c3aed" fill="url(#tg)" strokeWidth={2}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Plan distribution */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">Tenants by Plan</p>
          {planDist.length===0 ? (
            <p className="text-white/30 text-sm text-center py-8">No plan data</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={planDist} style={CHART_STYLE}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)"/>
                <XAxis dataKey="name" tick={TICK_STYLE} tickLine={false} axisLine={false}/>
                <YAxis tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false}/>
                <Tooltip contentStyle={TIP_STYLE} cursor={{fill:'rgba(255,255,255,0.05)'}}/>
                <Bar dataKey="count" fill="#7c3aed" radius={[4,4,0,0]} name="Tenants"/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent errors */}
      {(data?.recentErrors||[]).length>0 && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-red-400 flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>Unresolved Errors</p>
            <a href="/superadmin/docs" className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white transition-colors"><Book className="w-3 h-3"/>DB Security</a>
          </div>
          <div className="space-y-2">
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
            {(data.recentErrors||[]).slice(0,5).map((e:any)=>(
              <div key={e.id} className="flex items-start gap-3 text-xs">
                <span className={cn('px-1.5 py-0.5 rounded font-bold shrink-0 uppercase',e.level==='fatal'?'bg-red-500/20 text-red-400':'bg-amber-500/20 text-amber-400')}>{e.level}</span>
                <span className="text-white/60 flex-1 truncate">{e.message}</span>
                <span className="text-white/30 shrink-0">{formatRelativeTime(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
