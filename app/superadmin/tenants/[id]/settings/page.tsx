'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Crown, Loader2, Building2, Globe, Lock, ListChecks, ArrowLeft,
  Calendar, Clock, ShieldCheck, KeyRound, AlertCircle, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TenantSettingsAuditPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    if (!params?.id) return;
    fetch(`/api/superadmin/tenant-settings?tenant_id=${params.id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!ignore) setData(d); })
      .catch(() => { if (!ignore) setData({ error: true }); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [params?.id]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (!data || data.error) return (
    <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 p-5 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-red-700 dark:text-red-300">Could not load tenant settings</p>
        <Link href="/superadmin/tenants" className="text-xs text-red-700/70 dark:text-red-300/70 hover:underline">← back to tenants</Link>
      </div>
    </div>
  );

  const t = data.tenant;
  const s = data.settings;
  const loc = s.localization;
  const lp  = s.login_policy;
  const pl  = s.picklists;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href={`/superadmin/tenants`} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2">
            <ArrowLeft className="w-3 h-3" /> All tenants
          </Link>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-500" />
            Settings audit · <span className="font-mono text-violet-600">{t.name}</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
            <span className="font-mono">{t.slug}</span>
            <span className="px-1.5 py-0.5 bg-muted rounded uppercase tracking-wider text-[9px] font-bold">{t.plan_id}</span>
            <span className={cn('px-1.5 py-0.5 rounded uppercase tracking-wider text-[9px] font-bold',
              t.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
              t.status === 'trialing' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>{t.status}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-lg px-3 py-1.5">
          <Eye className="w-3.5 h-3.5" /> Read-only audit view — use impersonation to make changes
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Members"  value={t.active_members} />
        <Stat label="Users"    value={t.current_users} />
        <Stat label="Contacts" value={t.current_contacts} />
        <Stat label="Deals"    value={t.current_deals} />
      </div>

      {/* Localization */}
      <Section title="Localization" icon={Globe}>
        {!loc && <Empty>Using platform defaults (no overrides)</Empty>}
        {loc && (
          <Grid>
            <KV k="Timezone"        v={loc.timezone} />
            <KV k="Currency"        v={loc.currency} />
            <KV k="Fiscal year"     v={loc.fiscal_year_start_month ? `Starts month ${loc.fiscal_year_start_month}` : '—'} />
            <KV k="Week starts"     v={loc.week_start} />
            <KV k="Number format"   v={loc.number_format} />
            <KV k="Weekend days"    v={(loc.weekend_days ?? []).join(', ')} />
            {loc.business_hours && (
              <>
                <KV k="Business hours" v={loc.business_hours.enabled
                  ? `${loc.business_hours.start_time}–${loc.business_hours.end_time} on ${(loc.business_hours.working_days ?? []).join(', ')}`
                  : 'Disabled'} />
              </>
            )}
            <KV k="Holidays"        v={`${loc.holidays?.length ?? 0} configured`} />
          </Grid>
        )}
      </Section>

      {/* Login policy */}
      <Section title="Login & Security Policy" icon={Lock}>
        {!lp && <Empty>Using platform defaults</Empty>}
        {lp?.password && (
          <SubBlock title="Password" icon={KeyRound}>
            <Grid>
              <KV k="Min length"       v={lp.password.min_length} />
              <KV k="Max age (days)"   v={lp.password.max_age_days || 'Never'} />
              <KV k="Prevent reuse"    v={`${lp.password.prevent_reuse_count} past`} />
              <KV k="Require rules"    v={[
                lp.password.require_uppercase && 'uppercase',
                lp.password.require_number    && 'number',
                lp.password.require_symbol    && 'symbol',
              ].filter(Boolean).join(', ') || 'none'} />
            </Grid>
          </SubBlock>
        )}
        {lp?.two_factor && (
          <SubBlock title="Two-factor" icon={ShieldCheck}>
            <Grid>
              <KV k="Enforcement"      v={lp.two_factor.enforcement} />
              <KV k="Grace period"     v={`${lp.two_factor.grace_period_days} days`} />
            </Grid>
          </SubBlock>
        )}
        {lp?.session && (
          <SubBlock title="Sessions" icon={Clock}>
            <Grid>
              <KV k="Idle timeout"     v={lp.session.idle_timeout_minutes ? `${lp.session.idle_timeout_minutes} min` : 'Never'} />
              <KV k="Max lifetime"     v={`${lp.session.max_lifetime_hours} h`} />
              <KV k="Max concurrent"   v={lp.session.max_concurrent || 'Unlimited'} />
            </Grid>
          </SubBlock>
        )}
        {lp?.network && (
          <SubBlock title="Network" icon={Globe}>
            <Grid>
              <KV k="IP allowlist"     v={lp.network.ip_allowlist_enabled ? 'ON' : 'off'} />
              <KV k="Entries"          v={`${lp.network.ip_allowlist?.length ?? 0} CIDR`} />
            </Grid>
          </SubBlock>
        )}
        {lp?.login && (
          <SubBlock title="Sign-up" icon={KeyRound}>
            <Grid>
              <KV k="Self-signup"      v={lp.login.allow_self_signup ? 'ON' : 'off'} />
              <KV k="Allowed domains"  v={(lp.login.allowed_email_domains ?? []).join(', ') || 'all'} />
              <KV k="Blocked domains"  v={(lp.login.blocked_email_domains ?? []).join(', ') || 'none'} />
            </Grid>
          </SubBlock>
        )}
      </Section>

      {/* Picklists */}
      <Section title="Picklists" icon={ListChecks}>
        {!pl && <Empty>Using platform defaults</Empty>}
        {pl && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(pl).map(([cat, list]: any) => (
              <div key={cat} className="rounded-lg border border-border p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  {cat.replace(/_/g, ' ')} <span className="text-muted-foreground/50 font-normal">({list?.length ?? 0})</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {(list ?? []).slice(0, 12).map((e: any) => (
                    <span key={e.value} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">{e.label}</span>
                  ))}
                  {(list?.length ?? 0) > 12 && <span className="text-[10px] text-muted-foreground">+{list.length - 12} more</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Other keys */}
      {s.other_keys?.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-4 text-xs">
          <p className="font-semibold text-muted-foreground mb-1">Other settings keys present:</p>
          <p className="font-mono text-muted-foreground/80">{s.other_keys.join(', ')}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-0.5">{value ?? 0}</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" /> {title}
      </p>
      {children}
    </div>
  );
}

function SubBlock({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-2">
      <p className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
        <Icon className="w-3 h-3" /> {title}
      </p>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{children}</div>;
}

function KV({ k, v }: { k: string; v: any }) {
  return (
    <div className="text-xs">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
      <p className="font-mono font-medium truncate">{String(v ?? '—')}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}
