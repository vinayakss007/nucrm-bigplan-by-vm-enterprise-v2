/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { clientLogError } from '@/lib/client-logger';
import {
  Crown, Loader2, Globe, Lock, ListChecks, ArrowLeft, Clock, ShieldCheck, KeyRound, AlertCircle, Eye, Save, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface TenantSettingsData {
  tenant: {
    name: string;
    slug: string;
    plan_id: string;
    status: string;
    active_members: number;
    current_users: number;
    current_contacts: number;
    current_deals: number;
  };
  settings: {
    localization?: {
      timezone?: string;
      currency?: string;
      fiscal_year_start_month?: number;
      week_start?: string;
      number_format?: string;
      weekend_days?: string[];
      business_hours?: { enabled: boolean; start_time: string; end_time: string; working_days?: string[] };
      holidays?: unknown[];
    } | null;
    login_policy?: {
      password?: { min_length: number; max_age_days: number; prevent_reuse_count: number; require_uppercase: boolean; require_number: boolean; require_symbol: boolean };
      two_factor?: { enforcement: string; grace_period_days: number };
      session?: { idle_timeout_minutes: number; max_lifetime_hours: number; max_concurrent: number };
      network?: { ip_allowlist_enabled: boolean; ip_allowlist?: string[] };
      login?: { allow_self_signup: boolean; allowed_email_domains?: string[]; blocked_email_domains?: string[] };
    } | null;
    picklists?: Record<string, { value: string; label: string }[]> | null;
    other_keys?: string[];
  };
  error?: boolean;
}

export default function TenantSettingsAuditPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<TenantSettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedSettings, setEditedSettings] = useState<TenantSettingsData['settings'] | null>(null);

  const loadData = useCallback(() => {
    if (!params?.id) return;
    setLoading(true);
    fetch(`/api/superadmin/tenant-settings?tenant_id=${params.id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((d) => {
        setData(d);
        setEditedSettings(JSON.parse(JSON.stringify(d.settings)));
      })
      .catch((err) => { clientLogError('tenant-settings:fetch', err); setData({ tenant: { name: '', slug: '', plan_id: '', status: '', active_members: 0, current_users: 0, current_contacts: 0, current_deals: 0 }, settings: {}, error: true }); })
      .finally(() => setLoading(false));
  }, [params?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    if (!params?.id || !editedSettings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/superadmin/tenant-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: params.id, settings: editedSettings }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Settings saved successfully');
        setEditing(false);
        loadData();
      } else {
        toast.error(d.error || 'Failed to save settings');
      }
    } catch {
      toast.error('Failed to save settings');
    }
    setSaving(false);
  };

  const updateLocalization = (key: string, value: string | number) => {
    setEditedSettings(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        localization: { ...(prev.localization ?? {}), [key]: value },
      };
    });
  };

  const updateLoginPolicy = (section: string, key: string, value: string | number | boolean) => {
    setEditedSettings(prev => {
      if (!prev) return prev;
      const lp = prev.login_policy ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sectionData = (lp as any)[section] ?? {};
      return {
        ...prev,
        login_policy: { ...lp, [section]: { ...sectionData, [key]: value } },
      };
    });
  };

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
  const s = editing ? (editedSettings ?? data.settings) : data.settings;
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
        <div className="flex items-center gap-2">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/20 hover:bg-violet-100 dark:hover:bg-violet-950/40 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit Settings
            </button>
          ) : (
            <>
              <button
                onClick={() => { setEditing(false); setEditedSettings(JSON.parse(JSON.stringify(data.settings))); }}
                className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save Changes
              </button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <div className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/20 border border-violet-300 dark:border-violet-800 rounded-lg px-3 py-1.5">
          <Pencil className="w-3.5 h-3.5" /> Editing mode - make changes and click Save
        </div>
      )}

      {!editing && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-lg px-3 py-1.5">
          <Eye className="w-3.5 h-3.5" /> Read-only audit view - click Edit Settings to make changes
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Members"  value={t.active_members} />
        <Stat label="Users"    value={t.current_users} />
        <Stat label="Contacts" value={t.current_contacts} />
        <Stat label="Deals"    value={t.current_deals} />
      </div>

      {/* Localization */}
      <Section title="Localization" icon={Globe}>
        {!loc && !editing && <Empty>Using platform defaults (no overrides)</Empty>}
        {(loc || editing) && (
          <Grid>
            <EditableKV k="Timezone" v={loc?.timezone} editing={editing} onChange={(v) => updateLocalization('timezone', v)} />
            <EditableKV k="Currency" v={loc?.currency} editing={editing} onChange={(v) => updateLocalization('currency', v)} />
            <EditableKV k="Fiscal year start month" v={loc?.fiscal_year_start_month} editing={editing} type="number" onChange={(v) => updateLocalization('fiscal_year_start_month', parseInt(v) || 1)} />
            <EditableKV k="Week starts" v={loc?.week_start} editing={editing} onChange={(v) => updateLocalization('week_start', v)} />
            <EditableKV k="Number format" v={loc?.number_format} editing={editing} onChange={(v) => updateLocalization('number_format', v)} />
            {!editing && <KV k="Weekend days" v={(loc?.weekend_days ?? []).join(', ')} />}
            {!editing && loc?.business_hours && (
              <KV k="Business hours" v={loc.business_hours.enabled
                ? `${loc.business_hours.start_time}-${loc.business_hours.end_time} on ${(loc.business_hours.working_days ?? []).join(', ')}`
                : 'Disabled'} />
            )}
            {!editing && <KV k="Holidays" v={`${loc?.holidays?.length ?? 0} configured`} />}
          </Grid>
        )}
      </Section>

      {/* Login policy */}
      <Section title="Login & Security Policy" icon={Lock}>
        {!lp && !editing && <Empty>Using platform defaults</Empty>}
        {(lp?.password || editing) && (
          <SubBlock title="Password" icon={KeyRound}>
            <Grid>
              <EditableKV k="Min length" v={lp?.password?.min_length} editing={editing} type="number" onChange={(v) => updateLoginPolicy('password', 'min_length', parseInt(v) || 8)} />
              <EditableKV k="Max age (days)" v={lp?.password?.max_age_days || 'Never'} editing={editing} type="number" onChange={(v) => updateLoginPolicy('password', 'max_age_days', parseInt(v) || 0)} />
              <EditableKV k="Prevent reuse" v={lp?.password?.prevent_reuse_count} editing={editing} type="number" onChange={(v) => updateLoginPolicy('password', 'prevent_reuse_count', parseInt(v) || 0)} />
              {!editing && <KV k="Require rules" v={[
                lp?.password?.require_uppercase && 'uppercase',
                lp?.password?.require_number    && 'number',
                lp?.password?.require_symbol    && 'symbol',
              ].filter(Boolean).join(', ') || 'none'} />}
            </Grid>
          </SubBlock>
        )}
        {(lp?.two_factor || editing) && (
          <SubBlock title="Two-factor" icon={ShieldCheck}>
            <Grid>
              <EditableKV k="Enforcement" v={lp?.two_factor?.enforcement} editing={editing} onChange={(v) => updateLoginPolicy('two_factor', 'enforcement', v)} />
              <EditableKV k="Grace period (days)" v={lp?.two_factor?.grace_period_days} editing={editing} type="number" onChange={(v) => updateLoginPolicy('two_factor', 'grace_period_days', parseInt(v) || 0)} />
            </Grid>
          </SubBlock>
        )}
        {(lp?.session || editing) && (
          <SubBlock title="Sessions" icon={Clock}>
            <Grid>
              <EditableKV k="Idle timeout (min)" v={lp?.session?.idle_timeout_minutes} editing={editing} type="number" onChange={(v) => updateLoginPolicy('session', 'idle_timeout_minutes', parseInt(v) || 0)} />
              <EditableKV k="Max lifetime (h)" v={lp?.session?.max_lifetime_hours} editing={editing} type="number" onChange={(v) => updateLoginPolicy('session', 'max_lifetime_hours', parseInt(v) || 24)} />
              <EditableKV k="Max concurrent" v={lp?.session?.max_concurrent || 'Unlimited'} editing={editing} type="number" onChange={(v) => updateLoginPolicy('session', 'max_concurrent', parseInt(v) || 0)} />
            </Grid>
          </SubBlock>
        )}
        {!editing && lp?.network && (
          <SubBlock title="Network" icon={Globe}>
            <Grid>
              <KV k="IP allowlist" v={lp.network.ip_allowlist_enabled ? 'ON' : 'off'} />
              <KV k="Entries" v={`${lp.network.ip_allowlist?.length ?? 0} CIDR`} />
            </Grid>
          </SubBlock>
        )}
        {!editing && lp?.login && (
          <SubBlock title="Sign-up" icon={KeyRound}>
            <Grid>
              <KV k="Self-signup" v={lp.login.allow_self_signup ? 'ON' : 'off'} />
              <KV k="Allowed domains" v={(lp.login.allowed_email_domains ?? []).join(', ') || 'all'} />
              <KV k="Blocked domains" v={(lp.login.blocked_email_domains ?? []).join(', ') || 'none'} />
            </Grid>
          </SubBlock>
        )}
      </Section>

      {/* Picklists */}
      <Section title="Picklists" icon={ListChecks}>
        {!pl && <Empty>Using platform defaults</Empty>}
        {pl && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(pl).map(([cat, list]) => (
              <div key={cat} className="rounded-lg border border-border p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  {cat.replace(/_/g, ' ')} <span className="text-muted-foreground/50 font-normal">({list?.length ?? 0})</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {(list ?? []).slice(0, 12).map((e: { value: string; label: string }) => (
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
      {s.other_keys != null && s.other_keys.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-4 text-xs">
          <p className="font-semibold text-muted-foreground mb-1">Other settings keys present:</p>
          <p className="font-mono text-muted-foreground/80">{s.other_keys.join(', ')}</p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums mt-0.5">{value ?? 0}</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" /> {title}
      </p>
      {children}
    </div>
  );
}

function SubBlock({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
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

function KV({ k, v }: { k: string; v: string | number | null | undefined }) {
  return (
    <div className="text-xs">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
      <p className="font-mono font-medium truncate">{String(v ?? '-')}</p>
    </div>
  );
}

function EditableKV({ k, v, editing, type = 'text', onChange }: { k: string; v: string | number | null | undefined; editing: boolean; type?: string; onChange?: (value: string) => void }) {
  if (!editing) {
    return <KV k={k} v={v} />;
  }
  return (
    <div className="text-xs">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p>
      <input
        type={type}
        value={v ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full mt-0.5 px-2 py-1 rounded border border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20 text-xs font-mono focus:outline-none focus:border-violet-500"
        placeholder="-"
      />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}
