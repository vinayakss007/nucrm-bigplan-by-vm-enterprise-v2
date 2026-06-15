'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Crown, Loader2, Globe, Lock, ListChecks, Settings as SettingsIcon,
  ShieldCheck, ShieldX, ShieldAlert, Users, Plane, Sparkles, AlertTriangle,
  Activity, ArrowRightLeft, History, RefreshCw, Building2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Adoption = {
  total_tenants: number;
  adoption: { localization: number; login_policy: number; picklists: number; user_defaults: number };
  drift: { weak_password_policy: number; two_factor_off: number; two_factor_required: number; ip_allowlist_on: number; self_signup_on: number };
  users: { total: number; with_prefs: number; out_of_office_now: number };
};

type AuditRow = {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  id: string; action: string; entity_type: string; created_at: string; new_data: any;
  tenant_id: string; tenant_name: string | null;
  user_id: string | null; user_name: string | null; user_email: string | null;
};

type Activity = {
  bulk_ops: AuditRow[];
  settings_changes: AuditRow[];
  critical: AuditRow[];
};

export default function AdoptionMonitoringPage() {
  const [data, setData] = useState<Adoption | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    const [adoptionRes, activityRes] = await Promise.all([
      fetch('/api/superadmin/adoption').then(r => r.ok ? r.json() : null).catch((err) => { console.error('[adoption] fetch failed', err); return null; }),
      fetch('/api/superadmin/recent-activity?limit=20').then(r => r.ok ? r.json() : null).catch((err) => { console.error('[adoption] activity fetch failed', err); return null; }),
    ]);
    setData(adoptionRes);
    setActivity(activityRes);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-sm text-muted-foreground">Failed to load adoption metrics.</div>;

  const pct = (v: number, total: number) => (total === 0 ? 0 : Math.round((v / total) * 100));

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-500" /> Settings Adoption & Drift
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            How many tenants have configured each major settings tree, weak configurations, and recent platform activity. Read-only.
          </p>
        </div>
        <button onClick={load} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Overview stats — desktop dense */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat icon={Building2} label="Active tenants" value={data.total_tenants} />
        <Stat icon={Users}     label="Active users"   value={data.users.total} />
        <Stat icon={Sparkles}  label="Users w/ prefs" value={data.users.with_prefs}
          sub={`${pct(data.users.with_prefs, data.users.total)}%`} />
        <Stat icon={Plane}     label="OOO now"        value={data.users.out_of_office_now}
          accent={data.users.out_of_office_now > 0 ? 'amber' : undefined} />
        <Stat icon={ShieldX}   label="2FA off"        value={data.drift.two_factor_off}
          sub={`${pct(data.drift.two_factor_off, data.total_tenants)}%`}
          accent={data.drift.two_factor_off > 0 ? 'amber' : undefined} />
        <Stat icon={ShieldCheck} label="2FA required" value={data.drift.two_factor_required}
          sub={`${pct(data.drift.two_factor_required, data.total_tenants)}%`} accent="emerald" />
        <Stat icon={ShieldAlert} label="Weak pwd"     value={data.drift.weak_password_policy}
          accent={data.drift.weak_password_policy > 0 ? 'amber' : undefined} />
        <Stat icon={Lock}      label="IP allowlist on" value={data.drift.ip_allowlist_on} />
      </div>

      {/* Two-column layout on XL: adoption bars + activity feeds */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* LEFT: Adoption + drift cards (xl: 1 col) */}
        <div className="xl:col-span-1 space-y-4">
          <Card title="Settings tree adoption" desc="% of active tenants that configured each tree.">
            <div className="space-y-3">
              <Bar icon={Globe}        label="Localization"  count={data.adoption.localization}  total={data.total_tenants} />
              <Bar icon={Lock}         label="Login Policy"  count={data.adoption.login_policy}  total={data.total_tenants} />
              <Bar icon={ListChecks}   label="Picklists"     count={data.adoption.picklists}     total={data.total_tenants} />
              <Bar icon={SettingsIcon} label="User Defaults" count={data.adoption.user_defaults} total={data.total_tenants} />
            </div>
          </Card>

          <Card title="Security drift signals" desc="Configurations weaker than recommended.">
            <div className="space-y-2">
              <DriftRow severity={data.drift.weak_password_policy > 0 ? 'warn' : 'ok'}
                icon={ShieldAlert} label="Weak password policy" sub="Min length below 12"
                count={data.drift.weak_password_policy} total={data.total_tenants} />
              <DriftRow severity={data.drift.two_factor_off > 0 ? 'warn' : 'ok'}
                icon={ShieldX} label="2FA disabled" sub="Enforcement = off"
                count={data.drift.two_factor_off} total={data.total_tenants} />
              <DriftRow severity="ok" icon={ShieldCheck} label="2FA required" sub="Enforced for everyone"
                count={data.drift.two_factor_required} total={data.total_tenants} positive />
              <DriftRow severity="ok" icon={Lock} label="IP allowlist on" sub="CIDR-restricted access"
                count={data.drift.ip_allowlist_on} total={data.total_tenants} positive />
              <DriftRow severity={data.drift.self_signup_on > 0 ? 'info' : 'ok'}
                icon={AlertTriangle} label="Self-signup enabled" sub="Anyone can join"
                count={data.drift.self_signup_on} total={data.total_tenants} />
            </div>
          </Card>
        </div>

        {/* RIGHT: Activity feeds (xl: 2 cols) */}
        <div className="xl:col-span-2 space-y-4">
          <Card title="Critical activity" desc="Bulk transfers, login policy changes, OOO reassigns, role changes." icon={AlertTriangle} accent="amber">
            <ActivityList rows={activity?.critical ?? []} />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Recent bulk operations" desc="Bulk_* audit entries across tenants." icon={ArrowRightLeft}>
              <ActivityList rows={activity?.bulk_ops ?? []} compact />
            </Card>
            <Card title="Recent settings changes" desc="Localization, login policy, picklists, defaults, tags." icon={History}>
              <ActivityList rows={activity?.settings_changes ?? []} compact />
            </Card>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Need a deep dive? Open a tenant from <Link href="/superadmin/tenants" className="text-violet-600 hover:underline">Tenants</Link> and use the "Settings audit" link to see its full configuration.
      </p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Stat({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: number | string; sub?: string; accent?: 'amber' | 'red' | 'emerald' }) {
  const accentBg =
    accent === 'amber'   ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300/80 dark:border-amber-800/80 shadow-sm' :
    accent === 'red'     ? 'bg-red-50 dark:bg-red-950/30 border-red-300/80 dark:border-red-800/80 shadow-sm' :
    accent === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300/80 dark:border-emerald-800/80 shadow-sm' :
                           'bg-card border-border/80 shadow-sm';
  return (
    <div className={cn('rounded-xl border-2 p-3 hover:shadow-md transition-shadow', accentBg)}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        <Icon className="w-3 h-3" /> <span className="truncate">{label}</span>
      </div>
      <p className="text-3xl font-black tabular-nums mt-1 text-black dark:text-white">{value}</p>
      {sub && <p className="text-[10px] font-medium text-muted-foreground/60 mt-1">{sub}</p>}
    </div>
  );
}

function Card({ title, desc, icon: Icon, accent, children }: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  title: string; desc?: string; icon?: any; accent?: 'amber';
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-xl border bg-card overflow-hidden',
      accent === 'amber' ? 'border-amber-300/60 dark:border-amber-800/60' : 'border-border',
    )}>
      <div className={cn(
        'px-4 py-3 border-b',
        accent === 'amber' ? 'border-amber-200/40 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20' : 'border-border'
      )}>
        <p className="text-sm font-semibold flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
          {title}
        </p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Bar({ icon: Icon, label, count, total }: { icon: any; label: string; count: number; total: number }) {
  const p = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 text-sm">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium">{label}</span>
        </div>
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {count}/{total} <span className="text-muted-foreground/60">({p}%)</span>
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all',
          p >= 75 ? 'bg-emerald-500' : p >= 40 ? 'bg-amber-500' : 'bg-red-500')}
          style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function DriftRow({ icon: Icon, label, sub, count, total, severity, positive }: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any; label: string; sub: string; count: number; total: number;
  severity: 'ok' | 'info' | 'warn' | 'danger'; positive?: boolean;
}) {
  const tones = {
    ok:     'border-border bg-muted/10',
    info:   'border-blue-300/60 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-950/20',
    warn:   'border-amber-300/60 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/20',
    danger: 'border-red-300/60 dark:border-red-800/60 bg-red-50/40 dark:bg-red-950/20',
  };
  const iconColor =
    positive ? 'text-emerald-600' :
    severity === 'danger' ? 'text-red-600' :
    severity === 'warn'   ? 'text-amber-600' :
    severity === 'info'   ? 'text-blue-600' : 'text-muted-foreground';
  const p = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className={cn('rounded-lg border p-2.5 flex items-start gap-2.5', tones[severity])}>
      <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate">{label}</p>
          <span className="text-xs font-bold tabular-nums shrink-0">{count}<span className="text-muted-foreground font-normal"> ({p}%)</span></span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
      </div>
    </div>
  );
}

function ActivityList({ rows, compact }: { rows: AuditRow[]; compact?: boolean }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">No recent activity.</p>;
  }
  return (
    <ul className={cn('divide-y divide-border -mx-4', compact && 'text-xs')}>
      {rows.map(row => (
        <li key={row.id} className="px-4 py-2 hover:bg-accent/30 transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 mr-1.5">{row.action}</span>
                <span className="text-muted-foreground">{row.entity_type}</span>
                {row.new_data?.count != null && (
                  <span className="ml-1 text-violet-600 dark:text-violet-400 font-bold tabular-nums">×{row.new_data.count}</span>
                )}
                {row.new_data?.total != null && (
                  <span className="ml-1 text-violet-600 dark:text-violet-400 font-bold tabular-nums">×{row.new_data.total}</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                <Link href={`/superadmin/tenants/${row.tenant_id}/settings`} className="hover:underline">
                  {row.tenant_name ?? 'unknown tenant'}
                </Link>
                {row.user_name && <> · by <span className="text-foreground/70">{row.user_name}</span></>}
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{relTime(row.created_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function relTime(iso: string) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const dt = Date.now() - t;
  const mins = Math.floor(dt / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
