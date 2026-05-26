'use client';
import { useState, useEffect } from 'react';
import {
  Users, Building2, TrendingUp, CheckSquare, DollarSign,
  Activity, AlertTriangle, Target, Clock, ArrowUpRight,
  ChevronRight, Calendar, Zap,
} from 'lucide-react';
import { formatCurrency, formatRelativeTime, formatDate, cn } from '@/lib/utils';
import Link from 'next/link';
import { AnimatedNumber } from '@/components/shared/animated-number';
import { Breadcrumb } from '@/components/shared/breadcrumb';

const STAGE_COLORS: Record<string,string> = {
  lead:'text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400',
  qualified:'text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400',
  proposal:'text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400',
  negotiation:'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
  won:'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400',
  lost:'text-red-500 bg-red-100 dark:bg-red-900/30 dark:text-red-400',
};

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-lg', className)} />;
}

function StatCard({ icon: Icon, label, value, sub, color, href, loading }: any) {
  const content = (
    <div className="admin-card p-5 hover:border-violet-300 dark:hover:border-violet-700/50 transition-all group">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', color)}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      {loading
        ? <div className="h-7 w-24 rounded-lg skeleton-shimmer mb-1" />
        : <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>}
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function DashboardClient({ tenantId, userId, planName, isAdmin }: {
  tenantId: string; userId: string; planName: string; isAdmin: boolean;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Cache in sessionStorage — re-fetch every 3 minutes
    const CACHE_KEY = `dashboard_${tenantId}`;
    const CACHE_TTL = 3 * 60 * 1000;
    
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data: cd, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) { 
          setData(cd); 
          setLoading(false); 
          return; 
        }
      }
    } catch (e) {
      console.error('Cache parse error:', e);
    }
    
    fetch('/api/tenant/dashboard/stats', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        if (d.error) {
          console.error('API error:', d.error);
          setError(d.error);
        } else if (d.data) {
          setData(d.data);
          try { 
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: d.data, ts: Date.now() })); 
          } catch (e) {
            console.error('Cache set error:', e);
          }
        } else {
          console.warn('No data in response:', d);
          setError('No data received');
        }
        setLoading(false);
      })
      .catch((e) => {
        console.error('Fetch error:', e);
        setError(e.message);
        setLoading(false);
      });
  }, [tenantId]);

  const ACTIVITY_ICONS: Record<string,any> = {
    note: Activity, call: Target, email: Activity,
    meeting: Calendar, created: Zap, task_completed: CheckSquare,
    deal_won: TrendingUp, stage_change: TrendingUp,
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground capitalize">{planName} plan</p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          <strong>Error loading data:</strong> {error}
        </div>
      )}

      {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard loading={loading} icon={Users}      label="Total Contacts"  value={data?.contactCount?.toLocaleString()} sub={`${data?.companyCount ?? '—'} companies`} color="bg-violet-50 dark:bg-violet-950/30 text-violet-600" href="/tenant/contacts"/>
        <StatCard loading={loading} icon={TrendingUp} label="Open Pipeline"   value={formatCurrency(data?.pipeline ?? 0)} sub={`${data?.openDealsCount ?? '—'} active deals`} color="bg-amber-50 dark:bg-amber-950/30 text-amber-600" href="/tenant/deals"/>
        <StatCard loading={loading} icon={DollarSign} label="Won This Month"  value={formatCurrency(data?.wonThisMonth ?? 0)} sub="Revenue closed" color="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600" href="/tenant/deals"/>
        <StatCard loading={loading} icon={CheckSquare} label="Tasks Due Today" value={data?.tasksDueToday ?? '—'} sub={data?.overdueTasks ? `${data.overdueTasks} overdue` : 'None overdue'} color={`${(data?.overdueTasks ?? 0) > 0 ? 'bg-red-50 dark:bg-red-950/30 text-red-600' : 'bg-blue-50 dark:bg-blue-950/30 text-blue-600'}`} href="/tenant/tasks"/>
      </div>

      {/* Main content: 2 col */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Activity feed */}
        <div className="lg:col-span-2 admin-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <p className="text-sm font-semibold">Recent Activity</p>
            <Link href="/tenant/contacts" className="text-xs text-violet-600 hover:underline">View all →</Link>
          </div>
          {loading
            ? <div className="divide-y divide-border">{[...Array(5)].map((_,i) => <div key={i} className="flex items-start gap-3 px-5 py-3"><Skeleton className="w-8 h-8 rounded-full shrink-0"/><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-3/4"/><Skeleton className="h-3 w-1/2"/></div></div>)}</div>
            : !(data?.activities?.length)
              ? <div className="py-10 text-center text-sm text-muted-foreground">No activity yet — start by adding contacts</div>
              : <div className="divide-y divide-border">
                  {(data.activities ?? []).map((a: any) => {
                    const Icon = ACTIVITY_ICONS[a.type] ?? Activity;
                    return (
                      <div key={a.id} className="flex items-start gap-3 px-5 py-3 hover:bg-accent/20 transition-colors">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground"/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{a.description}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {a.full_name ?? 'System'} · {formatRelativeTime(a.created_at)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Tasks */}
          <div className="admin-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold">Tasks</p>
              <Link href="/tenant/tasks" className="text-xs text-violet-600 hover:underline">All →</Link>
            </div>
            {loading
              ? <div className="p-4 space-y-2">{[...Array(4)].map((_,i) => <Skeleton key={i} className="h-8 w-full"/>)}</div>
              : !(data?.tasks?.length)
                ? <p className="text-sm text-muted-foreground text-center py-6">No open tasks</p>
                : <div className="divide-y divide-border">
                    {(() => {
                      const today = new Date().toISOString().split('T')[0] || '';
                      return (data.tasks ?? []).slice(0,5).map((t: any) => {
                        const overdue = t.due_date && t.due_date < today;
                        return (
                          <Link key={t.id} href="/tenant/tasks" className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-accent/20 transition-colors">
                            <div className={cn('w-2 h-2 rounded-full shrink-0', t.priority==='high'?'bg-red-500':t.priority==='medium'?'bg-amber-500':'bg-slate-300')}/>
                            <p className="text-xs flex-1 truncate">{t.title}</p>
                            {t.due_date && <span className={cn('text-[10px] shrink-0', overdue?'text-red-500 font-bold':'text-muted-foreground')}>{overdue?'⚠':''} {formatDate(t.due_date)}</span>}
                          </Link>
                        );
                      });
                    })()}
                  </div>}
          </div>

          {/* Upcoming deals */}
          <div className="admin-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-semibold">Closing Soon</p>
              <Link href="/tenant/deals" className="text-xs text-violet-600 hover:underline">All →</Link>
            </div>
            {loading
              ? <div className="p-4 space-y-2">{[...Array(3)].map((_,i) => <Skeleton key={i} className="h-10 w-full"/>)}</div>
              : !(data?.upcomingDeals?.length)
                ? <p className="text-sm text-muted-foreground text-center py-6">No deals closing soon</p>
                : <div className="divide-y divide-border">
                    {(data.upcomingDeals ?? []).map((d: any) => (
                      <Link key={d.id} href="/tenant/deals" className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-accent/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{d.title}</p>
                          <span className={cn('text-[10px] px-1.5 rounded-full', STAGE_COLORS[d.stage]||STAGE_COLORS["lead"])}>{d.stage}</span>
                        </div>
                        <span className="text-xs font-bold text-violet-600 shrink-0">{formatCurrency(Number(d.value))}</span>
                      </Link>
                    ))}
                  </div>}
          </div>
        </div>
      </div>

      {/* Recent contacts */}
      <div className="admin-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <p className="text-sm font-semibold">Recent Contacts</p>
          <Link href="/tenant/contacts" className="text-xs text-violet-600 hover:underline flex items-center gap-1">View all <ArrowUpRight className="w-3 h-3"/></Link>
        </div>
        {loading
          ? <div className="divide-y divide-border">{[...Array(5)].map((_,i) => <div key={i} className="flex items-center gap-3 px-5 py-3"><Skeleton className="w-9 h-9 rounded-full shrink-0"/><div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-40"/><Skeleton className="h-3 w-28"/></div></div>)}</div>
          : !(data?.recentContacts?.length)
            ? <div className="py-10 text-center"><p className="text-sm text-muted-foreground">No contacts yet</p><Link href="/tenant/contacts" className="text-sm text-violet-600 hover:underline mt-1 inline-block">Add your first contact →</Link></div>
            : <div className="divide-y divide-border">
                {(data.recentContacts ?? []).map((c: any) => (
                  <Link key={c.id} href={`/tenant/contacts/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/20 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {c.first_name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{c.first_name} {c.last_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.email || c.company_name || 'No email'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize', STAGE_COLORS[c.lead_status as string]||STAGE_COLORS["lead"])}>
                        {c.lead_status}
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(c.created_at)}</p>
                    </div>
                  </Link>
                ))}
              </div>}
      </div>
    </div>
  );
}
