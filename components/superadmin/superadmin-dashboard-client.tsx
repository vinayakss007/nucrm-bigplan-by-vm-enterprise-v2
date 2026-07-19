'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Building2, Users, DollarSign, AlertTriangle, Clock,
  Zap, Search, Activity, RefreshCw,
  TrendingUp, Shield, Database, Server, Mail
} from 'lucide-react';
import Link from 'next/link';
import { cn, formatCurrency, formatDate, formatRelativeTime } from '@/lib/utils';
import { logError } from '@/lib/errors-client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface StatsData {
  mrr?: number;
  active_tenants?: number;
  total_users?: number;
  unresolved_errors?: number;
  trialing?: number;
}

interface Tenant {
  id: string;
  name: string;
  plan_id: string;
  status: string;
  created_at: string;
  trial_ends_at?: string;
  price_monthly?: number;
  owner_email?: string;
}

interface ErrorLog {
  level: string;
  message: string;
  created_at: string;
}

interface ExpiringTrial {
  id: string;
  name: string;
  trial_ends_at: string;
  days_left: number;
}

interface SearchResult {
  id: string;
  name: string;
  email?: string;
  type: 'tenant' | 'user';
  status?: string;
}

interface HealthCheck {
  service: string;
  status: string;
  latency_ms?: number;
}

interface RevenueData {
  mrr?: { mrr?: number; paying?: number; trialing?: number; free_tier?: number };
  events?: { id: string; event_type: string; tenant_name?: string; amount?: number; created_at: string }[];
}

interface UsageData {
  growth?: Array<Record<string, unknown>>;
}

interface ActivityItem {
  type: string;
  name?: string;
  message?: string;
  created_at?: string;
  timestamp?: string;
}

const TICK = { fill: 'rgba(255,255,255,0.3)', fontSize: 10 };
const TIP = { background: 'hsl(222,32%,9%)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 };

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
  trialing: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
  suspended: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  trial_expired: 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  cancelled: 'bg-gray-50 text-gray-500 dark:bg-gray-900/30 dark:text-gray-400',
  past_due: 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
};

const HEALTH_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  database: Database, app: Server, email: Mail, storage: Database,
};

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tenant_created: Building2,
  bulk_export: TrendingUp,
  bulk_import: TrendingUp,
  bulk_delete: AlertTriangle,
  settings_update: Zap,
  security_event: Shield,
};

interface DashboardProps {
  stats: StatsData;
  recentTenants: Tenant[];
  recentErrors: ErrorLog[];
  expiringSoon: ExpiringTrial[];
  userName: string;
}

export default function SuperAdminDashboardClient({
  stats, recentTenants, recentErrors, expiringSoon, userName,
}: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [healthLoading, setHealthLoading] = useState(true);

  const [revenueData, setRevenueData] = useState<RevenueData | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const activityRef = useRef<HTMLDivElement>(null);

  const [alertsDismissed, setAlertsDismissed] = useState<Set<string>>(new Set());

  const mrr = Number(stats.mrr ?? 0);

  // Global search
  const handleSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/superadmin/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results ?? []);
    } catch (err) {
      logError({ error: err, context: 'superadmin-search' });
    } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { if (searchQuery) handleSearch(searchQuery); }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, handleSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSearch(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch health, revenue, usage, activity on mount
  useEffect(() => {
    let ignore = false;
    Promise.all([
      fetch('/api/superadmin/health').then(r => r.json()).catch(() => ({ checks: [] })),
      fetch('/api/superadmin/revenue').then(r => r.json()).catch(() => ({})),
      fetch('/api/superadmin/usage').then(r => r.json()).catch(() => ({})),
      fetch('/api/superadmin/recent-activity?limit=10').then(r => r.json()).catch(() => ({})),
    ]).then(([health, rev, usage, act]) => {
      if (ignore) return;
      setHealthChecks(health.checks ?? []);
      setRevenueData(rev);
      setUsageData(usage);
      const items = [
        ...(act.bulk_ops ?? []),
        ...(act.settings_changes ?? []),
        ...(act.critical ?? []),
      ].sort((a: ActivityItem, b: ActivityItem) => {
        const ta = a.created_at ?? a.timestamp ?? '';
        const tb = b.created_at ?? b.timestamp ?? '';
        return tb.localeCompare(ta);
      }).slice(0, 10);
      setActivity(items);
      setHealthLoading(false);
      setActivityLoading(false);
    });
    return () => { ignore = true; };
  }, []);

  const allUp = healthChecks.every(c => c.status === 'up');
  const anyDown = healthChecks.some(c => c.status === 'down');
  const healthStatus = anyDown ? 'down' : allUp ? 'up' : 'degraded';

  const recentBillingEvents = revenueData?.events?.slice(0, 5) ?? [];

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Greeting + Search */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {userName.split(' ')[0] ?? 'Admin'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Here&apos;s your platform at a glance</p>
        </div>
        <div ref={searchRef} className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setShowSearch(true); }}
              onFocus={() => setShowSearch(true)}
              placeholder="Search tenants, users..."
              className="w-64 pl-10 pr-4 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:border-violet-500 transition-colors"
            />
            {searching && <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          </div>
          {showSearch && searchResults.length > 0 && (
            <div className="absolute top-full mt-2 w-full bg-card border border-border rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto">
              {searchResults.map(r => (
                <Link key={`${r.type}-${r.id}`} href={r.type === 'tenant' ? `/superadmin/tenants/${r.id}` : `/superadmin/users/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors border-b border-border last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center text-violet-600 dark:text-violet-400 font-bold text-sm shrink-0">
                    {r.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                    <p className="text-[10px] text-muted-foreground">{r.email ?? r.type}</p>
                  </div>
                  {r.status && <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize', STATUS_COLORS[r.status] || '')}>{r.status}</span>}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alert banners */}
      {(recentErrors.length > 0 || expiringSoon.length > 0) && !alertsDismissed.has('all') && (
        <div className="space-y-2">
          {recentErrors.length > 0 && !alertsDismissed.has('errors') && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-950/10">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <Link href="/superadmin/errors" className="text-sm text-red-600 dark:text-red-400 flex-1 hover:underline">
                {recentErrors.length} unresolved error{recentErrors.length > 1 ? 's' : ''} need attention
              </Link>
              <button onClick={() => setAlertsDismissed(prev => new Set(prev).add('errors'))} className="text-red-400/50 hover:text-red-500 text-xs">Dismiss</button>
            </div>
          )}
          {expiringSoon.length > 0 && !alertsDismissed.has('trials') && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-950/10">
              <Clock className="w-4 h-4 text-amber-500 shrink-0" />
              <Link href="/superadmin/tenants" className="text-sm text-amber-600 dark:text-amber-400 flex-1 hover:underline">
                {expiringSoon.length} trial{expiringSoon.length > 1 ? 's' : ''} expiring in ≤3 days
              </Link>
              <button onClick={() => setAlertsDismissed(prev => new Set(prev).add('trials'))} className="text-amber-400/50 hover:text-amber-500 text-xs">Dismiss</button>
            </div>
          )}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: DollarSign, label: 'Monthly Revenue', value: formatCurrency(mrr), sub: `ARR: ${formatCurrency(mrr * 12)}`, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20', href: '/superadmin/revenue' },
          { icon: Building2, label: 'Active Tenants', value: (stats.active_tenants ?? 0).toLocaleString(), sub: `${stats.trialing ?? 0} trialing`, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/20', href: '/superadmin/tenants' },
          { icon: Users, label: 'Total Users', value: (stats.total_users ?? 0).toLocaleString(), sub: 'across all orgs', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/20', href: '/superadmin/users' },
          { icon: AlertTriangle, label: 'Open Errors', value: Number(stats.unresolved_errors ?? 0).toString(), sub: 'needs attention', color: Number(stats.unresolved_errors ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground', bg: Number(stats.unresolved_errors ?? 0) > 0 ? 'bg-red-50 dark:bg-red-950/20' : 'bg-muted', href: '/superadmin/errors' },
        ].map(m => (
          <Link key={m.label} href={m.href}
            className="rounded-xl border border-border bg-card p-5 hover:border-violet-300 dark:hover:border-violet-500/50 hover:bg-accent/50 transition-all group">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', m.bg)}>
                <m.icon className={cn('w-4 h-4', m.color)} />
              </div>
            </div>
            <p className={cn('text-2xl font-bold', m.color)}>{m.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
          </Link>
        ))}
      </div>

      {/* Three-col: Growth chart + Health + Billing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Usage growth chart */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-foreground mb-4">Platform Growth (30d)</p>
          {usageData?.growth && usageData.growth.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={usageData.growth}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="snapshot_date" tick={TICK} tickLine={false} axisLine={false} interval={4} />
                <YAxis tick={TICK} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TIP} />
                <Bar dataKey="contacts" fill="#7c3aed" radius={[2, 2, 0, 0]} name="Contacts" />
                <Bar dataKey="deals" fill="#4f46e5" radius={[2, 2, 0, 0]} name="Deals" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No usage data yet</div>
          )}
          <Link href="/superadmin/usage" className="block text-center text-xs text-violet-600 dark:text-violet-400 hover:underline mt-3">View detailed usage →</Link>
        </div>

        {/* System health mini */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-foreground">System Health</p>
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
              healthStatus === 'up' ? 'bg-emerald-500/15 text-emerald-500' :
              healthStatus === 'down' ? 'bg-red-500/15 text-red-500' :
              'bg-amber-500/15 text-amber-500'
            )}>
              {healthStatus === 'up' ? 'ALL UP' : healthStatus === 'down' ? 'ISSUES' : 'DEGRADED'}
            </span>
          </div>
          {healthLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-8 rounded bg-muted/50 animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {healthChecks.slice(0, 4).map(c => {
                const Icon = HEALTH_ICONS[c.service] ?? Activity;
                return (
                  <div key={c.service} className="flex items-center gap-2">
                    <Icon className={cn('w-3.5 h-3.5', c.status === 'up' ? 'text-emerald-500' : 'text-red-500')} />
                    <span className="text-xs text-foreground flex-1 capitalize">{c.service}</span>
                    {c.latency_ms != null && <span className="text-[10px] text-muted-foreground">{c.latency_ms}ms</span>}
                    <span className={cn('w-1.5 h-1.5 rounded-full', c.status === 'up' ? 'bg-emerald-500' : 'bg-red-500')} />
                  </div>
                );
              })}
              {healthChecks.length === 0 && <p className="text-xs text-muted-foreground">No health data</p>}
            </div>
          )}
          <Link href="/superadmin/health" className="block text-center text-xs text-violet-600 dark:text-violet-400 hover:underline mt-3">Full health dashboard →</Link>
        </div>

        {/* Billing summary */}
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-semibold text-foreground mb-4">Billing Summary</p>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Paying tenants</span>
              <span className="text-sm font-bold text-foreground">{revenueData?.mrr?.paying ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Trialing</span>
              <span className="text-sm font-bold text-amber-500">{revenueData?.mrr?.trialing ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Free tier</span>
              <span className="text-sm font-bold text-muted-foreground">{revenueData?.mrr?.free_tier ?? 0}</span>
            </div>
            <div className="border-t border-border pt-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Recent billing events</p>
              {recentBillingEvents.length > 0 ? recentBillingEvents.map(e => (
                <div key={e.id} className="flex items-center gap-2 py-1.5">
                  <div className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                    e.event_type.includes('paid') || e.event_type === 'upgrade' ? 'bg-emerald-500' :
                    e.event_type.includes('fail') || e.event_type === 'cancelled' ? 'bg-red-500' : 'bg-amber-500'
                  )} />
                  <span className="text-xs text-foreground flex-1 truncate">{e.tenant_name ?? 'Unknown'}</span>
                  <span className="text-[10px] text-muted-foreground">{e.event_type.replace(/_/g, ' ')}</span>
                </div>
              )) : <p className="text-xs text-muted-foreground">No recent events</p>}
            </div>
          </div>
          <Link href="/superadmin/revenue" className="block text-center text-xs text-violet-600 dark:text-violet-400 hover:underline mt-3">Revenue dashboard →</Link>
        </div>
      </div>

      {/* Two-col: Recent signups + Activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent signups */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Recent Signups</p>
            <Link href="/superadmin/tenants" className="text-xs text-violet-600 dark:text-violet-400 hover:underline">View all →</Link>
          </div>
          {!recentTenants.length
            ? <p className="text-muted-foreground text-sm text-center py-8">No tenants yet</p>
            : <div className="divide-y divide-border">
              {recentTenants.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center text-violet-600 dark:text-violet-400 font-bold text-sm shrink-0">
                    {t.name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{t.owner_email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize', STATUS_COLORS[t.status] || STATUS_COLORS['active'])}>{t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          }
        </div>

        {/* Activity feed */}
        <div className="rounded-xl border border-border bg-card overflow-hidden" ref={activityRef}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground">Recent Activity</p>
            <Link href="/superadmin/logs" className="text-xs text-violet-600 dark:text-violet-400 hover:underline">View all →</Link>
          </div>
          {activityLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-10 rounded bg-muted/50 animate-pulse" />)}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No recent activity</p>
          ) : (
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {activity.map((item, i) => {
                const Icon = ACTIVITY_ICONS[item.type] ?? Activity;
                return (
                  <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center shrink-0">
                      <Icon className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {item.name ? <span className="font-medium">{item.name}</span> : null}
                        {item.message ? ` ${item.message}` : ` ${item.type?.replace(/_/g, ' ')}`}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatRelativeTime(item.created_at ?? item.timestamp ?? new Date().toISOString())}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Expiring trials + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {expiringSoon.length > 0 && (
          <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-950/10 overflow-hidden">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 px-5 py-3 border-b border-amber-200 dark:border-amber-500/10">Trials Expiring Soon</p>
            <div className="divide-y divide-amber-200/50 dark:divide-amber-500/5">
              {expiringSoon.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                  <p className="text-sm text-foreground flex-1 truncate">{t.name}</p>
                  <span className={cn('text-xs font-bold', t.days_left <= 1 ? 'text-red-500' : 'text-amber-500')}>
                    {t.days_left <= 0 ? 'Expired' : `${t.days_left}d left`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'New Tenant', href: '/superadmin/tenants', icon: Building2 },
              { label: 'Create User', href: '/superadmin/users', icon: Users },
              { label: 'Revenue', href: '/superadmin/revenue', icon: DollarSign },
              { label: 'Settings', href: '/superadmin/settings', icon: Zap },
              { label: 'Backups', href: '/superadmin/backups', icon: Database },
              { label: 'Monitoring', href: '/superadmin/monitoring', icon: Activity },
            ].map(a => (
              <Link key={a.label} href={a.href}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-accent hover:border-violet-300 dark:hover:border-violet-500 text-xs text-muted-foreground hover:text-foreground transition-all">
                <a.icon className="w-3.5 h-3.5 shrink-0" />{a.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Error log preview */}
      {recentErrors.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />Recent Errors
            </p>
            <Link href="/superadmin/errors" className="text-xs text-violet-600 dark:text-violet-400 hover:underline">View all →</Link>
          </div>
          <div className="divide-y divide-border">
            {recentErrors.map((e, i) => (
              <div key={i} className="flex items-start gap-2 px-5 py-3">
                <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', e.level === 'fatal' ? 'bg-red-500' : 'bg-orange-500')} />
                <p className="text-xs text-muted-foreground flex-1 truncate">{e.message}</p>
                <p className="text-[10px] text-muted-foreground/60 shrink-0 whitespace-nowrap">{formatDate(e.created_at)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
