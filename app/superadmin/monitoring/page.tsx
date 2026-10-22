/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useApiQuery } from '@/lib/query/client';
import {
  Activity, AlertTriangle, CheckCircle, RefreshCw, Building2, Users,
  DollarSign, Database, Server, Book,
} from 'lucide-react';
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils';
import InlineErrorState from '@/components/shared/inline-error-state';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

// #3071: exactly what GET /api/health answers (app/api/health/route.ts:88-98) — the old
// db_latency_ms/uptime_s/node/missing_tables were Prometheus metric keys, never JSON fields
// of this response, and rendered confident zeros and hard-coded greens.
interface HealthData {
  status?: string;
  db?: string;
  schema_ready?: boolean;
  service?: string;
  version?: string;
  sentry?: string;
  timestamp?: string;
}

interface MonitoringData {
  stats?: {
    mrr?: number;
    active_tenants?: number;
    total_users?: number;
    unresolved_errors?: number;
  };
  planDist?: Array<{ name: string; tenant_count: number; price_monthly: number }>;
  tenantGrowth?: Array<{ day: string; count: number }>;
  backupStatus?: { total?: number; completed?: number; failed?: number; running?: number };
  restoreStatus?: { total?: number; pending?: number; running?: number; completed?: number; failed?: number };
  recentBackups?: Array<{ id: string; status: string; backup_name?: string; size_bytes?: number; created_at: string }>;
  recentErrors?: Array<{ id: string; level: string; message: string; created_at: string }>;
}

const CHART_STYLE = { background:'transparent' };
const TICK_STYLE  = { fill:'rgba(255,255,255,0.3)', fontSize:10 };
const TIP_STYLE   = { background:'hsl(222,32%,9%)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, fontSize:11 };

export default function MonitoringPage() {
  // #1328: TanStack Query replaces fetch + useEffect + useState. The 30s
  // auto-refresh becomes refetchInterval; the manual button calls refetch().
  const monitoringQuery = useApiQuery<MonitoringData>(
    ['superadmin', 'monitoring'], '/api/superadmin/monitoring', { refetchInterval: 30_000 },
  );
  const healthQuery = useApiQuery<HealthData>(
    ['superadmin', 'health'], '/api/health', { refetchInterval: 30_000 },
  );

  const data: MonitoringData | null = monitoringQuery.data ?? null;
  const health: HealthData | null = healthQuery.data ?? null;
  const loading = monitoringQuery.isLoading || healthQuery.isLoading;
  const refreshing = monitoringQuery.isFetching || healthQuery.isFetching;
  // #2872: `dataUpdatedAt` is 0 until a read answers, and the `|| Date.now()` this line used
  // to carry turned "never answered" into "just now" — a timestamp about a tick that did not
  // happen. A refused tick leaves the previous tick's `dataUpdatedAt` in place, which is the
  // honest thing to print, and the caveat below says so.
  const lastReadAt = Math.max(monitoringQuery.dataUpdatedAt ?? 0, healthQuery.dataUpdatedAt ?? 0);
  const lastRefresh = lastReadAt ? new Date(lastReadAt).toISOString() : null;
  const load = () => { monitoringQuery.refetch(); healthQuery.refetch(); };

  const s  = data?.stats ?? {};
  const hs = health ?? {};
  // #2872 — this page's refused refresh is not the operator's action, it is the TIMER. Both
  // reads carry `refetchInterval: 30_000` (`/api/superadmin/monitoring`, `/api/health`), the page
  // issues no mutation and invalidates nothing, so every 30 seconds a read that already
  // answered asks again and the platform's answer can be a 500, a dead pool or a 504. TanStack
  // Query hands the page back the payload the previous tick produced (lib/query/client.tsx:47-58
  // keeps `data` when a refetch of a successful query fails), so `…Stale` is the state this
  // panel is in for most of its working life and `…Failed` is the outage. They cannot share one
  // branch: the outage has to say the figures are the page's own zeros, and the refused tick
  // has to say the figures are real, just one interval old — a tenant signed up, a backup that
  // finished or an error logged since the previous tick is not counted below.
  // The bare flag also fed two claims that are not the platform's: `allUp` read
  // `hs.status==='ok'` straight off an unread probe and answered "Issues Detected" for a probe
  // that never ran, while the Schema badge's `hs.schema_ready!==false` answered the other way —
  // falsely green. Those read `healthFailed`, every figure fed by the monitoring route reads
  // `monitoringFailed`, and a real 0 from a read that answered still prints 0.
  const monitoringFailed = Boolean(monitoringQuery.error) && !data;
  const monitoringStale = Boolean(monitoringQuery.error) && Boolean(data);
  const healthFailed = Boolean(healthQuery.error) && !health;
  const healthStale = Boolean(healthQuery.error) && Boolean(health);
  const monitoringReason = monitoringQuery.error?.message || 'no response from the server';
  const healthReason = healthQuery.error?.message || 'no response from the server';
  const allUp = hs.status==='ok' && !healthFailed;

  const Metric = ({ label, value, icon:Icon, color, sub }: { label: string; value: string | number; icon: React.ComponentType<{ className?: string }>; color: string; sub?: string }) => (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-white/40">{label}</p>
        <Icon className={cn('w-4 h-4',color)}/>
      </div>
      <p className={cn('text-2xl font-bold text-white',color)}>{value}</p>
      {sub&&<p className="text-xs text-white/30 mt-1">{sub}</p>}
    </div>
  );

  const ServiceBadge = ({ name, ok, latency, unknown }:{name:string;ok:boolean;latency?:number;unknown?:boolean}) => (
    <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border',unknown?'border-white/10 bg-white/5':ok?'border-emerald-500/20 bg-emerald-500/5':'border-red-500/20 bg-red-500/5')}>
      <div className={cn('w-2 h-2 rounded-full',unknown?'bg-white/20':ok?'bg-emerald-400':'bg-red-400 animate-pulse')}/>
      <span className="text-xs text-white/60 font-medium capitalize">{name}</span>
      {unknown&&<span className="text-[10px] text-white/30 ml-auto">not read</span>}
      {latency!==undefined&&<span className={cn('text-[10px] text-white/30',!unknown&&'ml-auto')}>{latency}ms</span>}
    </div>
  );

  // #2872: `isLoading` is true only while neither read has answered for the first time, so it
  // can never stand in for `…Failed` — a refused tick leaves it false with the whole dashboard
  // on screen. The sentence stays about the wait.
  if (loading) return (
    <div className="flex items-center gap-3 text-white/40 p-4">
      <RefreshCw className="w-4 h-4 animate-spin"/>Loading monitoring data...
    </div>
  );

  // Plan distribution
  const planDist = (data?.planDist||[]).map((p) => ({
    name: p.name, count: p.tenant_count,
    revenue: Number(p.price_monthly) * Number(p.tenant_count),
  }));

  // Tenant growth — fill missing days
  const growthMap: Record<string,number> = {};
  (data?.tenantGrowth||[]).forEach((d) => { growthMap[d.day] = d.count; });
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
          <p className="text-xs text-white/30">Last updated {formatRelativeTime(lastRefresh)} · Auto-refreshes every 30s</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium',healthFailed?'border-white/10 bg-white/5 text-white/40':allUp?'border-emerald-500/20 bg-emerald-500/5 text-emerald-400':'border-red-500/20 bg-red-500/5 text-red-400')}>
            {allUp?<CheckCircle className="w-3.5 h-3.5"/>:<AlertTriangle className="w-3.5 h-3.5"/>}
            {healthFailed?'Status not read':allUp?'All Systems Operational':'Issues Detected'}
          </div>
          <button onClick={()=>load()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 text-xs text-white/40 hover:text-white transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5',refreshing&&'animate-spin')}/>Refresh
          </button>
        </div>
      </div>

      {monitoringFailed && (
        <InlineErrorState
          message={`Failed to load platform monitoring: ${monitoringReason}. No tick of this panel has ever answered — the figures below are this page's own zeros, not measurements.`}
          onRetry={() => void monitoringQuery.refetch()}
        />
      )}

      {monitoringStale && (
        <InlineErrorState
          message={`Could not refresh platform monitoring, so the figures below are the previous tick — the last read: ${monitoringReason}. A tenant that signed up, a backup that finished or an error logged since then is not counted here.`}
          onRetry={() => void monitoringQuery.refetch()}
        />
      )}

      {healthFailed && (
        <InlineErrorState
          message={`Failed to load the health probe: ${healthReason}. The service badges below say nothing about the platform — this probe never ran.`}
          onRetry={() => void healthQuery.refetch()}
        />
      )}

      {healthStale && (
        <InlineErrorState
          message={`Could not refresh the health probe, so the service badges below are the previous tick — the last read: ${healthReason}. A database that went quiet since then is still shown as it was.`}
          onRetry={() => void healthQuery.refetch()}
        />
      )}

      {/* System health row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ServiceBadge name="Database" unknown={healthFailed} ok={hs.db==='connected'}/>
        <ServiceBadge name="App Server" unknown={healthFailed} ok={hs.status==='ok'}/>
        <ServiceBadge name="Schema" unknown={healthFailed || hs.schema_ready===undefined} ok={hs.schema_ready===true}/>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/5">
          <Server className="w-3.5 h-3.5 text-white/30"/>
          <span className="text-xs text-white/40">Version: <span className="text-white font-medium">{healthFailed ? '—' : hs.version ?? 'not reported'}</span></span>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Monthly Revenue" value={monitoringFailed ? '—' : formatCurrency(s.mrr ?? 0)} icon={DollarSign} color="text-emerald-400" sub={monitoringFailed ? undefined : `ARR: ${formatCurrency((s.mrr ?? 0)*12)}`}/>
        <Metric label="Active Tenants"  value={monitoringFailed ? '—' : (s.active_tenants ?? 0).toLocaleString()} icon={Building2} color="text-violet-400"/>
        <Metric label="Total Users"     value={monitoringFailed ? '—' : (s.total_users ?? 0).toLocaleString()} icon={Users} color="text-blue-400"/>
        <Metric label="Open Errors (24h)" value={monitoringFailed ? '—' : (s.unresolved_errors ?? 0).toString()} icon={AlertTriangle} color={!monitoringFailed && (s.unresolved_errors ?? 0)>0?'text-red-400':'text-white/20'} sub={monitoringFailed ? undefined : (s.unresolved_errors ?? 0)>0?'Check error logs':'Clean'}/>
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
              {!monitoringFailed && (data?.backupStatus?.running ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-xs text-blue-400">
                  <RefreshCw className="w-3 h-3 animate-spin"/>{data?.backupStatus?.running ?? 0} running
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center p-3 rounded-lg bg-white/5">
              <p className="text-xl font-bold text-white">{monitoringFailed ? '—' : data?.backupStatus?.total ?? 0}</p>
              <p className="text-[10px] text-white/40">Total</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-emerald-500/10">
              <p className="text-xl font-bold text-emerald-400">{monitoringFailed ? '—' : data?.backupStatus?.completed ?? 0}</p>
              <p className="text-[10px] text-white/40">Completed</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-500/10">
              <p className="text-xl font-bold text-red-400">{monitoringFailed ? '—' : data?.backupStatus?.failed ?? 0}</p>
              <p className="text-[10px] text-white/40">Failed</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-blue-500/10">
              <p className="text-xl font-bold text-blue-400">{monitoringFailed ? '—' : data?.backupStatus?.running ?? 0}</p>
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
              <p className="text-lg font-bold text-white">{monitoringFailed ? '—' : data?.restoreStatus?.total ?? 0}</p>
              <p className="text-[10px] text-white/40">Total</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-amber-500/10">
              <p className="text-lg font-bold text-amber-400">{monitoringFailed ? '—' : data?.restoreStatus?.pending ?? 0}</p>
              <p className="text-[10px] text-white/40">Pending</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-blue-500/10">
              <p className="text-lg font-bold text-blue-400">{monitoringFailed ? '—' : data?.restoreStatus?.running ?? 0}</p>
              <p className="text-[10px] text-white/40">Running</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-emerald-500/10">
              <p className="text-lg font-bold text-emerald-400">{monitoringFailed ? '—' : data?.restoreStatus?.completed ?? 0}</p>
              <p className="text-[10px] text-white/40">Done</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-red-500/10">
              <p className="text-lg font-bold text-red-400">{monitoringFailed ? '—' : data?.restoreStatus?.failed ?? 0}</p>
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
            {(data?.recentBackups || []).slice(0,5).map((b) => (
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
          {/* #2872: `last30` fills every day the read did not report with `0`, so over a read
              that never answered the curve was a flat line asserting nobody joined for a month. */}
          {monitoringFailed ? (
            <p className="text-white/30 text-sm text-center py-8">—</p>
          ) : (
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
          )}
        </div>

        {/* Plan distribution */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <p className="text-sm font-semibold text-white mb-4">Tenants by Plan</p>
          {monitoringFailed ? (
            <p className="text-white/30 text-sm text-center py-8">—</p>
          ) : planDist.length===0 ? (
            // #2829/#2872: an answered plan mix that came back with nothing in it may say so;
            // a read that never answered produced the same empty array and may not.
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
            {(data?.recentErrors||[]).slice(0,5).map((e)=>(
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
