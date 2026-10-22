/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { CheckCircle, XCircle, AlertTriangle, HelpCircle, RefreshCw, Activity, Database, Mail, Server, Wifi } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { logError } from '@/lib/errors-client';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';
import toast from 'react-hot-toast';

interface HealthCheck {
  service: string;
  status: string;
  latency_ms?: number;
  message?: string;
}

/** What `GET /api/superadmin/health` answers: `app/api/superadmin/health/route.ts:84`. */
interface HealthRoster { checks?: HealthCheck[] }

/** What `GET /api/health` answers: `app/api/health/route.ts:88-98`. Flat, and 503 when unhealthy. */
interface AppProbe {
  status?: string;
  db?: string;
  schema_ready?: boolean;
  service?: string;
  version?: string;
  sentry?: string;
  message?: string;
  timestamp?: string;
}

type BoardStatus = 'up' | 'degraded' | 'down' | 'unread';

const STATUS_CFG: Record<string,{icon:React.ComponentType<{ className?: string }>;color:string;bg:string}> = {
  up:       { icon:CheckCircle,   color:'text-emerald-400', bg:'border-emerald-500/20 bg-emerald-500/5' },
  degraded: { icon:AlertTriangle, color:'text-amber-400',   bg:'border-amber-500/20 bg-amber-500/5' },
  down:     { icon:XCircle,       color:'text-red-400',     bg:'border-red-500/20 bg-red-500/5' },
  // A read that did not answer is not a system state: it gets its own palette, never green or red.
  unread:   { icon:HelpCircle,    color:'text-white/40',    bg:'border-white/10 bg-white/[0.02]' },
};
const NEUTRAL = STATUS_CFG['unread']!;
const SERVICE_ICONS: Record<string,React.ComponentType<{ className?: string }>> = {
  database:Database, app:Server, email:Mail, storage:Database, schema:Database,
};

function probeBoardStatus(probe: AppProbe | null): BoardStatus {
  if (!probe || typeof probe.status !== 'string') return 'unread';
  return probe.status === 'ok' ? 'up' : 'down';
}

function checkCfg(status: string) {
  return status === 'up' || status === 'down' || status === 'degraded' ? STATUS_CFG[status]! : NEUTRAL;
}

export default function HealthPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  // #1328 kept the two reads separate; #3069 routes them through `useApiQuery` so a failed read
  // arrives as an error with its status and body intact instead of being resolved into a fabricated
  // answer. Node and uptime are not lost: the roster's `app` check reports them
  // (`app/api/superadmin/health/route.ts:38`), which is the probe that measures them.
  const {
    data: rosterData, error: rosterError, isLoading: rosterLoading, isFetching: rosterFetching,
    dataUpdatedAt: rosterUpdatedAt, refetch: refetchRoster,
  } = useApiQuery<HealthRoster>(['superadmin', 'health'], '/api/superadmin/health', {
    refetchInterval: autoRefresh ? 30_000 : false,
  });
  const {
    data: appData, error: appError, isLoading: appLoading, isFetching: appFetching,
    dataUpdatedAt: appUpdatedAt, refetch: refetchApp,
  } = useApiQuery<AppProbe>(['app', 'health'], '/api/health', {
    refetchInterval: autoRefresh ? 30_000 : false,
  });

  const rosterChecks = rosterData?.checks;
  const rosterKnown = Array.isArray(rosterChecks);
  const checks: HealthCheck[] = Array.isArray(rosterChecks) ? rosterChecks : [];
  const rosterReason = rosterError?.message || 'no response from the server';
  const rosterFailed = !rosterKnown && !rosterLoading;
  const rosterStale = Boolean(rosterError) && Boolean(rosterData);
  const rosterRefusal = rosterError?.status === 403;
  const rosterRefusalMessage = (rosterError?.info as { error?: string } | undefined)?.error ?? null;
  const rosterShapeGap = rosterData && !rosterKnown ? 'the response carried no service checks' : null;

  // /api/health answers 503 with a body naming which probe failed. The fetcher throws on any non-2xx
  // but keeps that body, so the 503 is read as the answer it is rather than as a dead line.
  const answered503 = appError?.status === 503 && typeof (appError.info as AppProbe | undefined)?.status === 'string';
  // The 503 body is the newest reading, so it wins over the older data the query still holds.
  const appProbe = answered503 ? (appError.info as AppProbe) : appData ?? null;
  const appReason = appError?.message || 'no response from the server';
  const appFailed = !appProbe && !appLoading;
  // A 503 that carries a body is a *newer* reading, not a refused refresh of the old one.
  const appStale = Boolean(appError) && Boolean(appData) && !answered503;

  const loading = rosterFetching || appFetching;
  const lastRun = (rosterUpdatedAt || appUpdatedAt)
    ? new Date(Math.max(rosterUpdatedAt, appUpdatedAt))
    : null;

  const run = () => { refetchRoster(); refetchApp(); };

  const rosterFresh = rosterKnown && !rosterStale;
  const appFresh = Boolean(appProbe) && !appStale;
  const anyDown = (rosterFresh && checks.some(c => c.status === 'down'))
    || (appFresh && appProbe !== null && probeBoardStatus(appProbe) === 'down');
  const nothingMonitored = rosterKnown && checks.length === 0;
  const allCurrent = rosterFresh && appFresh;
  const allUp = allCurrent && !nothingMonitored
    && checks.every(c => c.status === 'up') && probeBoardStatus(appProbe) === 'up';
  const overallStatus: BoardStatus = anyDown
    ? 'down'
    : !allCurrent || nothingMonitored
      ? 'unread'
      : allUp ? 'up' : 'degraded';
  const cfg = STATUS_CFG[overallStatus] ?? NEUTRAL;
  const appCfg = STATUS_CFG[probeBoardStatus(appProbe)] ?? NEUTRAL;

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
          <button onClick={() => run()} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/40 hover:text-white disabled:opacity-40 transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', loading&&'animate-spin')}/>Run Checks
          </button>
        </div>
      </div>

      {/* Overall status banner — `unread` is a statement about this board, not about the platform. */}
      <div className={cn('flex items-center gap-3 p-4 rounded-xl border', cfg.bg)}>
        <cfg.icon className={cn('w-5 h-5 shrink-0', cfg.color)}/>
        <div>
          <p className={cn('text-sm font-bold', cfg.color)}>
            {overallStatus==='up'?'All Systems Operational':overallStatus==='down'?'System Issues Detected':overallStatus==='degraded'?'Degraded Performance':'No current verdict'}
          </p>
          <p className="text-xs text-white/40">
            {rosterKnown && `${checks.length} service${checks.length!==1?'s':''} monitored`}
            {nothingMonitored && ' — an empty roster is not evidence that anything is working'}
            {!rosterKnown && !rosterLoading && !rosterRefusal && 'The service roster was not read, so this board reports nothing about it.'}
            {rosterStale && 'The roster below is the last reading, not a current one.'}
            {appStale && 'The application probe below is the last reading, not a current one.'}
            {!appProbe && !appLoading && ' The application probe did not answer either.'}
          </p>
        </div>
      </div>

      {rosterStale && (
        <InlineErrorState
          message={`Could not refresh the service roster, so the ${checks.length} checks below are the last read: ${rosterReason}. A service that went down or recovered since that read is still shown as it was then.`}
          onRetry={refetchRoster}
        />
      )}

      {rosterRefusal && !rosterKnown && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-amber-400">
            The roster refused this read{rosterRefusalMessage ? `: ${rosterRefusalMessage}` : '.'}
          </p>
          <p className="text-xs text-white/40 mt-1">
            The server answered, and what it answered is that this session may not read the health
            roster. Nothing here says the platform is up or down — re-check with a super-admin
            session. Every other block on this page still works.
          </p>
        </div>
      )}

      {rosterFailed && !rosterRefusal && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm font-semibold text-white/60 mb-2">No service roster to show</p>
          <InlineErrorState
            message={`Could not read the service roster: ${rosterShapeGap ?? rosterReason}. No check status is known, so this board prints no checks and no verdict about them.`}
            onRetry={refetchRoster}
          />
        </div>
      )}

      {/* Service checks grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {appStale && (
          <InlineErrorState
            className="sm:col-span-2"
            message={`Could not refresh the application probe, so the card below is the last read: ${appReason}. Whether the database or the schema changed since then is not known.`}
            onRetry={refetchApp}
          />
        )}

        {/* App health (from /api/health) */}
        {appProbe && (
          <div className={cn('rounded-xl border p-4', appCfg.bg)}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Server className={cn('w-4 h-4', appCfg.color)}/>
                <p className="text-sm font-semibold text-white">Application</p>
              </div>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', appProbe.status==='ok'?'bg-emerald-500/15 text-emerald-400':appProbe.status==='error'?'bg-red-500/15 text-red-400':'bg-white/10 text-white/40')}>
                {appProbe.status==='ok'?'UP':appProbe.status==='error'?'DOWN':'NOT REPORTED'}
              </span>
            </div>
            <div className="space-y-1 text-xs text-white/40">
              <p>Build: <span className="text-white/60">{appProbe.service ?? 'not reported'} {appProbe.version ?? ''}</span></p>
              <p>Database probe: <span className="text-white/60">{appProbe.db ?? 'not reported'}</span></p>
              <p>Schema: <span className={appProbe.schema_ready===true?'text-emerald-400':appProbe.schema_ready===false?'text-red-400':'text-white/60'}>{appProbe.schema_ready===true?'Ready':appProbe.schema_ready===false?'Not applied':'Not reported'}</span></p>
              <p>Error reporting: <span className="text-white/60">{appProbe.sentry ?? 'not reported'}</span></p>
              <p>Read at: <span className="text-white/60">{appProbe.timestamp ?? 'not reported'}</span></p>
              {appProbe.message && <p className="text-white/60">{appProbe.message}</p>}
            </div>
          </div>
        )}

        {appFailed && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm font-semibold text-white/60 mb-2">Application probe unread</p>
            <InlineErrorState
              message={`Could not read the application probe: ${appReason}. The card that normally shows the probe's own answer is not printed, because there is no answer.`}
              onRetry={refetchApp}
            />
          </div>
        )}

        {checks.map((c) => {
          const s = checkCfg(c.status);
          const Icon = SERVICE_ICONS[c.service] || Wifi;
          return (
            <div key={c.service} className={cn('rounded-xl border p-4', s.bg)}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={cn('w-4 h-4', s.color)}/>
                  <p className="text-sm font-semibold text-white capitalize">{c.service}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(c.latency_ms ?? 0) > 0 && <span className="text-[10px] text-white/30">{c.latency_ms}ms</span>}
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase', c.status==='up'?'bg-emerald-500/15 text-emerald-400':c.status==='down'?'bg-red-500/15 text-red-400':'bg-white/10 text-white/40')}>
                    {c.status}
                  </span>
                </div>
              </div>
              {c.message && <p className="text-xs text-white/40">{c.message}</p>}
            </div>
          );
        })}
      </div>

      {/* Run manual checks */}
      {/* Cron auth is handled server-side; no x-cron-secret header needed from the client */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <p className="text-sm font-semibold text-white mb-3">Manual Operations</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label:'Run Cleanup', action:async()=>{ try { const r=await fetch('/api/cron/cleanup',{method:'POST'}); if(r.status===423){ toast('Cleanup is already running — this request was skipped'); return; } if(!r.ok) throw new Error(); toast.success('Cleanup triggered'); } catch(err){ logError({ error: err, context: 'health:cleanup' }); toast.error('Cleanup failed'); } } },
            { label:'Check Backup Health', action:async()=>{ try { const r=await fetch('/api/cron/backup-health',{method:'POST'}); if(r.status===423){ toast('Backup health check is already running — this request was skipped'); return; } const d=await r.json(); if(!r.ok) throw new Error(); toast.success(`Backup health: ${d.status ?? 'ok'}`); } catch(err){ logError({ error: err, context: 'health:backup-health' }); toast.error('Backup health check failed'); } } },
            { label:'Take Usage Snapshot', action:async()=>{ try { const r=await fetch('/api/cron/usage-snapshot',{method:'POST'}); if(r.status===423){ toast('A usage snapshot is already being taken — this request was skipped'); return; } if(!r.ok) throw new Error(); toast.success('Snapshot taken'); } catch(err){ logError({ error: err, context: 'health:usage-snapshot' }); toast.error('Snapshot failed'); } } },
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
