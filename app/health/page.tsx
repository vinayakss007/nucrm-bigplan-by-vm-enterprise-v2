/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { CheckCircle, AlertCircle, XCircle, HelpCircle, Loader2, Database, Cpu, ShieldCheck, Tag, type LucideIcon } from 'lucide-react';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';

/**
 * The shape `GET /api/health` actually answers (app/api/health/route.ts): a flat body, and a 503
 * status line when the database is not connected or the schema is not ready. It has never returned
 * per-component sub-objects, so no card may read one.
 */
interface HealthStatus {
  status: 'ok' | 'error';
  db?: string;
  schema_ready?: boolean;
  service?: string;
  version?: string;
  sentry?: string;
  message?: string;
  timestamp?: string;
}

const statusIcons = {
  ok: CheckCircle,
  healthy: CheckCircle,
  warning: AlertCircle,
  error: XCircle,
  unhealthy: XCircle,
  degraded: AlertCircle,
  unknown: HelpCircle,
};

const statusColors = {
  ok: 'text-emerald-500',
  healthy: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  unhealthy: 'text-red-500',
  degraded: 'text-amber-500',
  unknown: 'text-gray-400',
};

export default function HealthPage() {
  const { data, error, isLoading, isFetching, refetch } = useApiQuery<HealthStatus>(['health'], '/api/health');
  const loading = isLoading;

  // The route answers 503 with a body naming which probe failed, and apiFetcher throws on any
  // non-2xx — so the 503 is taken from the body the fetcher carried, not treated as a dead read.
  const answered503 = error?.status === 503 && typeof (error.info as HealthStatus | undefined)?.status === 'string';
  const health = answered503 ? (error.info as HealthStatus) : data ?? null;
  const failed = !health && !loading;
  const stale = Boolean(error) && Boolean(data) && !answered503;
  const reason = error?.message || 'no response from the server';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">System Health</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              Real-time status of all system components
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
          >
            <Loader2 className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {failed && (
          /* Nothing was read, so nothing is asserted: no verdict and no component card. */
          <div className="p-6 rounded-xl border-2 mb-8 bg-gray-50 dark:bg-gray-900/40 border-gray-300 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-3">
              <HelpCircle className="w-8 h-8 text-gray-400" />
              <div>
                <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">No reading to report</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  The health request did not answer, so this page shows you nothing rather than a guess.
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Anything printed here would be a read that never happened — that is how a throttled
              request, a proxy timeout or a browser that could not reach the app all looked like a
              broken database. Try the read again; the page stays put either way.
            </p>
            <InlineErrorState message={`Health has not been read: ${reason}.`} onRetry={refetch} />
          </div>
        )}

        {health && (
          <>
            {/* Overall Status */}
            <div className={`p-6 rounded-xl border-2 mb-8 ${
              health.status === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
            }`}>
              <div className="flex items-center gap-3">
                {(() => {
                  const Icon = health.status === 'ok' ? CheckCircle : XCircle;
                  return <Icon className={`w-8 h-8 ${health.status === 'ok' ? 'text-emerald-500' : 'text-red-500'}`} />;
                })()}
                <div>
                  <p className={`text-lg font-semibold ${health.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    System {health.status === 'ok' ? 'Healthy' : 'Unhealthy'}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {health.status !== 'ok'
                      ? 'Some components need attention'
                      : stale
                        ? 'This verdict is the last reading, not a current one'
                        : 'All systems operational'}
                  </p>
                  {health.message && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{health.message}</p>
                  )}
                </div>
              </div>
            </div>

            {stale && (
              <InlineErrorState
                className="mb-8"
                message={`Could not refresh, so Database, Schema, Sentry and Release below are the last read (${reason}). The system may have gone down or come back up since, and this page cannot tell you which.`}
                onRetry={refetch}
              />
            )}

            {/* Component Cards */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Database — the route answers `db`, nothing finer. */}
              <HealthCard
                icon={Database}
                title="Database"
                status={health.db === 'connected' ? 'ok' : health.db ? 'error' : 'unknown'}
                details={[health.db, health.status !== 'ok' && health.db === 'disconnected'
                  ? 'the connection probe the route runs did not return'
                  : undefined].filter(Boolean).join(' • ')}
              />

              {/* Schema — whether the migrations in this build are applied. */}
              <HealthCard
                icon={Cpu}
                title="Schema"
                status={health.schema_ready === true ? 'ok' : health.schema_ready === false ? 'error' : 'unknown'}
                details={[
                  health.schema_ready === undefined
                    ? undefined
                    : health.schema_ready
                      ? 'the schema this build expects is present'
                      : 'the schema this build expects is not present',
                ].filter(Boolean).join(' • ')}
              />

              {/* Sentry — error reporting is a degraded/ok distinction, not a broken one. */}
              <HealthCard
                icon={ShieldCheck}
                title="Sentry"
                status={health.sentry === 'configured' ? 'ok' : health.sentry ? 'warning' : 'unknown'}
                details={[health.sentry].filter(Boolean).join(' • ')}
              />

              {/* Release — which build answered, and when. */}
              <HealthCard
                icon={Tag}
                title="Release"
                status={health.service && health.version ? 'ok' : 'unknown'}
                details={[health.service, health.version, health.timestamp].filter(Boolean).join(' • ')}
              />
            </div>
          </>
        )}

        {/* Quick Actions */}
        <div className="mt-8 p-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <a
              href="/setup"
              className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-950/30 transition-colors text-center font-medium"
            >
              Setup Admin
            </a>
            <a
              href="/api/health"
              target="_blank"
              className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/30 transition-colors text-center font-medium"
            >
              JSON API
            </a>
            <button
              onClick={() => window.location.reload()}
              className="p-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors font-medium"
            >
              Reload Page
            </button>
          </div>
        </div>

        {/* Commands */}
        <div className="mt-6 p-6 bg-gray-900 rounded-xl font-mono text-sm text-gray-300">
          <p className="text-gray-500 mb-3">// Useful commands</p>
          <p className="mb-2"><span className="text-violet-400">$</span> npm run db:setup <span className="text-gray-500"># Safe database setup</span></p>
          <p className="mb-2"><span className="text-violet-400">$</span> npm run worker <span className="text-gray-500"># Start background worker</span></p>
          <p className="mb-2"><span className="text-violet-400">$</span> npm run dev <span className="text-gray-500"># Start dev server</span></p>
        </div>
      </div>
    </div>
  );
}

function HealthCard({ 
  icon: Icon, 
  title, 
  status, 
  details 
}: { 
  icon: LucideIcon; 
  title: string; 
  status: string; 
  details: string;
}) {
  const StatusIcon = statusIcons[status as keyof typeof statusIcons] || HelpCircle;
  const statusColor = statusColors[status as keyof typeof statusColors] || 'text-gray-400';

  return (
    <div className="p-5 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <Icon className="w-5 h-5 text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-white">{title}</span>
        </div>
        <StatusIcon className={`w-5 h-5 ${statusColor}`} />
      </div>
      {details && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{details}</p>
      )}
    </div>
  );
}
