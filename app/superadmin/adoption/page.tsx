'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Crown, Loader2, Globe, Lock, ListChecks, Settings as SettingsIcon,
  ShieldCheck, ShieldX, ShieldAlert, Users, Plane, Sparkles, AlertTriangle,
  ArrowUpRight, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Adoption = {
  total_tenants: number;
  adoption: { localization: number; login_policy: number; picklists: number; user_defaults: number };
  drift: { weak_password_policy: number; two_factor_off: number; two_factor_required: number; ip_allowlist_on: number; self_signup_on: number };
  users: { total: number; with_prefs: number; out_of_office_now: number };
};

export default function AdoptionMonitoringPage() {
  const [data, setData] = useState<Adoption | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/superadmin/adoption')
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-sm text-muted-foreground">Failed to load adoption metrics.</div>;

  const pct = (v: number, total: number) => (total === 0 ? 0 : Math.round((v / total) * 100));

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Crown className="w-5 h-5 text-amber-500" /> Settings Adoption & Drift
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          How many tenants have configured each major settings tree, and which configurations look weak. Read-only.
        </p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users}     label="Active tenants"     value={data.total_tenants} />
        <Stat icon={Sparkles}  label="Active users"       value={data.users.total} />
        <Stat icon={Sparkles}  label="Users w/ prefs"     value={data.users.with_prefs}
          sub={`${pct(data.users.with_prefs, data.users.total)}%`} />
        <Stat icon={Plane}     label="Currently OOO"      value={data.users.out_of_office_now}
          accent={data.users.out_of_office_now > 0 ? 'amber' : undefined} />
      </div>

      {/* Adoption per settings tree */}
      <Card title="Settings tree adoption" desc="Percentage of active tenants that have configured each tree.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Bar icon={Globe}        label="Localization"       count={data.adoption.localization}  total={data.total_tenants} />
          <Bar icon={Lock}         label="Login Policy"       count={data.adoption.login_policy}  total={data.total_tenants} />
          <Bar icon={ListChecks}   label="Picklists"          count={data.adoption.picklists}     total={data.total_tenants} />
          <Bar icon={SettingsIcon} label="User Defaults"      count={data.adoption.user_defaults} total={data.total_tenants} />
        </div>
      </Card>

      {/* Drift signals */}
      <Card title="Security drift" desc="Tenants whose configuration is weaker than recommended.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DriftRow severity={data.drift.weak_password_policy > 0 ? 'warn' : 'ok'}
            icon={ShieldAlert}
            label="Weak password policy" sub="Min length below 12 characters"
            count={data.drift.weak_password_policy} total={data.total_tenants} />
          <DriftRow severity={data.drift.two_factor_off > 0 ? 'warn' : 'ok'}
            icon={ShieldX}
            label="2FA disabled" sub="Tenants with 2FA enforcement = off"
            count={data.drift.two_factor_off} total={data.total_tenants} />
          <DriftRow severity="ok"
            icon={ShieldCheck}
            label="2FA required" sub="Tenants enforcing 2FA for everyone"
            count={data.drift.two_factor_required} total={data.total_tenants} positive />
          <DriftRow severity="ok"
            icon={Lock}
            label="IP allowlist on" sub="Tenants restricting access by CIDR"
            count={data.drift.ip_allowlist_on} total={data.total_tenants} positive />
          <DriftRow severity={data.drift.self_signup_on > 0 ? 'info' : 'ok'}
            icon={AlertTriangle}
            label="Self-signup enabled" sub="Anyone with a valid email can join"
            count={data.drift.self_signup_on} total={data.total_tenants} />
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Need a deep dive? Open a tenant from <Link href="/superadmin/tenants" className="text-violet-600 hover:underline">Tenants</Link> and use the "Settings audit" link to see its full configuration.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: number | string; sub?: string; accent?: 'amber' | 'red' | 'emerald' }) {
  const accentBg =
    accent === 'amber' ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300/60 dark:border-amber-800/60' :
    accent === 'red'   ? 'bg-red-50 dark:bg-red-950/30 border-red-300/60 dark:border-red-800/60' :
    accent === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300/60 dark:border-emerald-800/60' :
    'bg-card border-border';
  return (
    <div className={cn('rounded-xl border p-4', accentBg)}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

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
          p >= 75 ? 'bg-emerald-500' :
          p >= 40 ? 'bg-amber-500'   :
                    'bg-red-500')}
          style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function DriftRow({ icon: Icon, label, sub, count, total, severity, positive }: {
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
    <div className={cn('rounded-lg border p-3 flex items-start gap-3', tones[severity])}>
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', iconColor)} />
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
