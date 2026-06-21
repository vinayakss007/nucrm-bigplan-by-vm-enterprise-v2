import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { users, tenants, plans, errorLogs } from '@/drizzle/schema';
import { eq, and, sql, desc, gte, between } from 'drizzle-orm';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Building2, Users, DollarSign, AlertTriangle, ArrowRight,
  Clock, CheckCircle, Zap } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default async function SuperAdminDashboard() {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/auth/login');
  const payload = await verifyToken(token);
  if (!payload) redirect('/auth/login');

  // Verify superadmin status
  const [user] = await db.select({
    isSuperAdmin: users.isSuperAdmin,
    fullName: users.fullName,
  })
  .from(users)
  .where(eq(users.id, payload.userId))
  .limit(1);

  if (!user?.isSuperAdmin) redirect('/tenant/dashboard');

<<<<<<< HEAD
  const [statsRes, recentTenants, recentErrors, _recentActivity, expiringSoon] = await Promise.all([
=======
  const [statsRes, recentTenants, recentErrors, recentActivity, expiringSoon] = await Promise.all([
>>>>>>> fix/batch-2-e2e-useEffect
    db.execute(sql`SELECT public.platform_stats() as data`).catch((err) => { console.error('[dashboard] platform_stats failed', err); return { rows: [{ data: {} }] }; }),
    
    db.select({
      id: tenants.id,
      name: tenants.name,
      plan_id: tenants.planId,
      status: tenants.status,
      created_at: tenants.createdAt,
      trial_ends_at: tenants.trialEndsAt,
      price_monthly: plans.priceMonthly,
      owner_email: users.email,
    })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .leftJoin(users, eq(users.id, tenants.ownerId))
    .orderBy(desc(tenants.createdAt))
    .limit(6)
    .catch((err) => { console.error('[dashboard] recentTenants failed', err); return []; }),

    db.select({
      level: errorLogs.level,
      message: errorLogs.message,
      created_at: errorLogs.createdAt,
    })
    .from(errorLogs)
    .where(and(
      eq(errorLogs.resolved, false),
      sql`${errorLogs.level} IN ('error','fatal')`
    ))
    .orderBy(desc(errorLogs.createdAt))
    .limit(5)
    .catch((err) => { console.error('[dashboard] recentErrors failed', err); return []; }),

    db.select({
      type: sql<string>`'tenant_created'`.as('type'),
      name: tenants.name,
      created_at: tenants.createdAt,
    })
    .from(tenants)
    .where(gte(tenants.createdAt, sql`now() - interval '7 days'`))
    .orderBy(desc(tenants.createdAt))
    .limit(8)
    .catch((err) => { console.error('[dashboard] recentActivity failed', err); return []; }),

    db.select({
      id: tenants.id,
      name: tenants.name,
      trial_ends_at: tenants.trialEndsAt,
      days_left: sql<number>`EXTRACT(day FROM ${tenants.trialEndsAt} - now())::int`,
    })
    .from(tenants)
    .where(and(
      eq(tenants.status, 'trialing'),
      between(tenants.trialEndsAt, sql`now()`, sql`now() + interval '3 days'`)
    ))
    .orderBy(tenants.trialEndsAt)
    .catch((err) => { console.error('[dashboard] expiringSoon failed', err); return []; }),
  ]);

  const s = (statsRes as any).rows?.[0]?.data ?? {};
  const mrr = Number(s.mrr ?? 0);

  const STATUS_COLORS: Record<string,string> = {
    active:       'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
    trialing:     'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
    suspended:    'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    trial_expired:'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    cancelled:    'bg-gray-50 text-gray-500 dark:bg-gray-900/30 dark:text-gray-400',
    past_due:     'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  };
  const PLAN_COLORS: Record<string,string> = {
    free:'text-muted-foreground', starter:'text-blue-600 dark:text-blue-400', pro:'text-violet-600 dark:text-violet-400', enterprise:'text-amber-600 dark:text-amber-400',
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-xl font-bold text-foreground">
          Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user.fullName?.split(' ')[0] ?? 'Admin'} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Here&apos;s your platform at a glance</p>
      </div>

      {/* Alerts */}
      {(recentErrors.length > 0 || expiringSoon.length > 0) && (
        <div className="space-y-2">
          {recentErrors.length > 0 && (
            <Link href="/superadmin/errors" className="flex items-center gap-3 p-3 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-950/10 hover:bg-red-100 dark:hover:bg-red-950/20 transition-colors">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400 flex-1">{recentErrors.length} unresolved error{recentErrors.length > 1 ? 's' : ''} need attention</p>
              <ArrowRight className="w-3.5 h-3.5 text-red-400/50" />
            </Link>
          )}
          {expiringSoon.length > 0 && (
            <Link href="/superadmin/tenants" className="flex items-center gap-3 p-3 rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-950/10 hover:bg-amber-100 dark:hover:bg-amber-950/20 transition-colors">
              <Clock className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-sm text-amber-600 dark:text-amber-400 flex-1">
                {expiringSoon.length} trial{expiringSoon.length > 1 ? 's' : ''} expiring in ≤3 days
              </p>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400/50" />
            </Link>
          )}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: DollarSign, label:'Monthly Revenue', value: formatCurrency(mrr), sub:`ARR: ${formatCurrency(mrr*12)}`, color:'text-emerald-600 dark:text-emerald-400', bg:'bg-emerald-50 dark:bg-emerald-950/20', href:'/superadmin/revenue' },
          { icon: Building2,  label:'Active Tenants',  value: (s.active_tenants??0).toLocaleString(), sub:`${s.trialing??0} trialing`, color:'text-violet-600 dark:text-violet-400', bg:'bg-violet-50 dark:bg-violet-950/20', href:'/superadmin/tenants' },
          { icon: Users,      label:'Total Users',     value: (s.total_users??0).toLocaleString(), sub:'across all orgs', color:'text-blue-600 dark:text-blue-400', bg:'bg-blue-50 dark:bg-blue-950/20', href:'/superadmin/users' },
          { icon: AlertTriangle, label:'Open Errors', value: (s.unresolved_errors??0).toString(), sub:'last 24 hours', color:(s.unresolved_errors??0)>0?'text-red-600 dark:text-red-400':'text-muted-foreground', bg:(s.unresolved_errors??0)>0?'bg-red-50 dark:bg-red-950/20':'bg-muted', href:'/superadmin/errors' },
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

      {/* Two-col layout */}
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
                      <p className={cn('text-[10px] capitalize mt-0.5', PLAN_COLORS[t.plan_id] || 'text-muted-foreground')}>{t.plan_id}</p>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>

        {/* Right col */}
        <div className="space-y-4">
          {/* Expiring trials */}
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

          {/* Error log preview */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />Recent Errors
              </p>
              <Link href="/superadmin/errors" className="text-xs text-violet-600 dark:text-violet-400 hover:underline">View all →</Link>
            </div>
            {!recentErrors.length
              ? <div className="flex items-center gap-2 px-5 py-4 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle className="w-4 h-4" />No unresolved errors</div>
              : <div className="divide-y divide-border">
                  {recentErrors.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 px-5 py-3">
                      <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', e.level==='fatal'?'bg-red-500':'bg-orange-500')} />
                      <p className="text-xs text-muted-foreground flex-1 truncate">{e.message}</p>
                      <p className="text-[10px] text-muted-foreground/60 shrink-0 whitespace-nowrap">{formatDate(e.created_at)}</p>
                    </div>
                  ))}
                </div>
            }
          </div>

          {/* Quick actions */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Actions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { label:'New Organization', href:'/superadmin/tenants', icon:Building2 },
                { label:'Create User', href:'/superadmin/users', icon:Users },
                { label:'View Revenue', href:'/superadmin/revenue', icon:DollarSign },
                { label:'Platform Settings', href:'/superadmin/settings', icon:Zap },
              ].map(a => (
                <Link key={a.label} href={a.href}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-accent hover:border-violet-300 dark:hover:border-violet-500 text-xs text-muted-foreground hover:text-foreground transition-all">
                  <a.icon className="w-3.5 h-3.5 shrink-0" />{a.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
