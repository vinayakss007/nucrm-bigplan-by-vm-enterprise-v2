'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, XCircle, Loader2, Database, Mail, Bell, User, Cpu } from 'lucide-react';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: { status: 'ok' | 'error'; message?: string; tables?: number };
  queue: { status: 'ok' | 'warning' | 'error'; provider?: string; message?: string };
  email: { status: 'ok' | 'warning' | 'error'; provider?: string; message?: string };
  auth: { status: 'ok' | 'warning' | 'error'; users?: number; superAdmin?: boolean };
  worker: { status: 'ok' | 'warning' | 'error'; running?: boolean; message?: string };
}

const statusIcons = {
  ok: CheckCircle,
  healthy: CheckCircle,
  warning: AlertCircle,
  error: XCircle,
  unhealthy: XCircle,
  degraded: AlertCircle,
};

const statusColors = {
  ok: 'text-emerald-500',
  healthy: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  unhealthy: 'text-red-500',
  degraded: 'text-amber-500',
};

export default function HealthPage() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => {
        setHealth(d);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const refresh = () => {
    setLoading(true);
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealth(d))
      .finally(() => setLoading(false));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
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
            onClick={refresh}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
          >
            <Loader2 className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Overall Status */}
        <div className={`p-6 rounded-xl border-2 mb-8 ${
          health?.status === 'healthy' 
            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' 
            : health?.status === 'degraded'
            ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800'
            : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
        }`}>
          <div className="flex items-center gap-3">
            {(() => {
              const Icon = statusIcons[health?.status || 'error'];
              return <Icon className={`w-8 h-8 ${statusColors[health?.status || 'error']}`} />;
            })()}
            <div>
              <p className={`text-lg font-semibold ${statusColors[health?.status || 'error']}`}>
                System {health?.status === 'healthy' ? 'Healthy' : health?.status === 'degraded' ? 'Degraded' : 'Unhealthy'}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {health?.status === 'healthy' 
                  ? 'All systems operational' 
                  : 'Some components need attention'}
              </p>
            </div>
          </div>
        </div>

        {/* Component Cards */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Database */}
          <HealthCard
            icon={Database}
            title="Database"
            status={health?.database.status || 'error'}
            details={[
              health?.database.tables ? `${health.database.tables} tables` : undefined,
              health?.database.message,
            ].filter(Boolean).join(' • ')}
          />

          {/* Queue */}
          <HealthCard
            icon={Cpu}
            title="Queue / Worker"
            status={health?.queue.status || 'error'}
            details={[
              health?.queue.provider,
              health?.queue.message,
            ].filter(Boolean).join(' • ')}
          />

          {/* Email */}
          <HealthCard
            icon={Mail}
            title="Email"
            status={health?.email.status || 'error'}
            details={[
              health?.email.provider ? `Provider: ${health.email.provider}` : undefined,
              health?.email.message,
            ].filter(Boolean).join(' • ')}
          />

          {/* Auth */}
          <HealthCard
            icon={User}
            title="Authentication"
            status={health?.auth.status || 'error'}
            details={[
              health?.auth.users !== undefined ? `${health.auth.users} users` : undefined,
              health?.auth.superAdmin ? 'Super admin configured' : 'No super admin',
              (health?.auth as any)?.message,
            ].filter(Boolean).join(' • ')}
          />
        </div>

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
  icon: any; 
  title: string; 
  status: string; 
  details: string;
}) {
  const StatusIcon = statusIcons[status as keyof typeof statusIcons] || XCircle;
  const statusColor = statusColors[status as keyof typeof statusColors] || 'text-red-500';

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
