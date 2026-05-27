'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Lock, ShieldCheck, Clock, Globe, KeyRound, AlertTriangle,
  Plus, X, Save, Loader2, ShieldX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Policy = {
  password: {
    min_length: number;
    require_uppercase: boolean;
    require_number: boolean;
    require_symbol: boolean;
    max_age_days: number;
    prevent_reuse_count: number;
  };
  two_factor: {
    enforcement: 'off' | 'optional' | 'required';
    grace_period_days: number;
  };
  session: {
    idle_timeout_minutes: number;
    max_lifetime_hours: number;
    max_concurrent: number;
  };
  network: {
    ip_allowlist_enabled: boolean;
    ip_allowlist: string[];
  };
  login: {
    allow_self_signup: boolean;
    allowed_email_domains: string[];
    blocked_email_domains: string[];
  };
};

const DEFAULTS: Policy = {
  password:   { min_length: 12, require_uppercase: true, require_number: true, require_symbol: true, max_age_days: 0, prevent_reuse_count: 5 },
  two_factor: { enforcement: 'optional', grace_period_days: 7 },
  session:    { idle_timeout_minutes: 60, max_lifetime_hours: 24, max_concurrent: 5 },
  network:    { ip_allowlist_enabled: false, ip_allowlist: [] },
  login:      { allow_self_signup: false, allowed_email_domains: [], blocked_email_domains: [] },
};

export default function LoginPolicyPage() {
  const [pol, setPol] = useState<Policy>(DEFAULTS);
  const [original, setOriginal] = useState<Policy>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);

  const [newIp, setNewIp] = useState('');
  const [newAllowedDomain, setNewAllowedDomain] = useState('');
  const [newBlockedDomain, setNewBlockedDomain] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/tenant/admin/login-policy').then(r => r.ok ? r.json() : { login_policy: DEFAULTS }),
      fetch('/api/tenant/me').then(r => r.ok ? r.json() : {}),
    ]).then(([d, me]: any[]) => {
      const p = d.login_policy ?? DEFAULTS;
      setPol(p); setOriginal(p);
      setIsAdmin(me?.is_admin ?? false);
    }).finally(() => setLoading(false));
  }, []);

  const dirty = useMemo(() => JSON.stringify(pol) !== JSON.stringify(original), [pol, original]);

  // Strength computed from current rules
  const passwordStrength = useMemo(() => {
    let score = 0;
    if (pol.password.min_length >= 12) score++;
    if (pol.password.min_length >= 16) score++;
    if (pol.password.require_uppercase) score++;
    if (pol.password.require_number) score++;
    if (pol.password.require_symbol) score++;
    if (pol.password.max_age_days > 0) score++;
    if (pol.password.prevent_reuse_count >= 5) score++;
    if (score <= 2) return { label: 'Weak',     color: 'text-red-600',     bar: 'bg-red-500',     pct: 25 };
    if (score <= 4) return { label: 'OK',       color: 'text-amber-600',   bar: 'bg-amber-500',   pct: 50 };
    if (score <= 6) return { label: 'Strong',   color: 'text-emerald-600', bar: 'bg-emerald-500', pct: 75 };
    return            { label: 'Excellent', color: 'text-emerald-700', bar: 'bg-emerald-600', pct: 100 };
  }, [pol.password]);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/tenant/admin/login-policy', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_policy: pol }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('Security policy saved');
      setOriginal(pol);
    } else {
      toast.error(d.error || 'Failed to save');
    }
    setSaving(false);
  };

  const addIp = () => {
    const v = newIp.trim();
    if (!v) return;
    if (pol.network.ip_allowlist.includes(v)) { toast.error('Already in list'); return; }
    setPol(p => ({ ...p, network: { ...p.network, ip_allowlist: [...p.network.ip_allowlist, v] } }));
    setNewIp('');
  };
  const removeIp = (v: string) =>
    setPol(p => ({ ...p, network: { ...p.network, ip_allowlist: p.network.ip_allowlist.filter(x => x !== v) } }));

  const addDomain = (kind: 'allowed' | 'blocked') => {
    const value = (kind === 'allowed' ? newAllowedDomain : newBlockedDomain).trim().toLowerCase();
    if (!value) return;
    const key = kind === 'allowed' ? 'allowed_email_domains' : 'blocked_email_domains';
    if (pol.login[key].includes(value)) { toast.error('Already in list'); return; }
    setPol(p => ({ ...p, login: { ...p.login, [key]: [...p.login[key], value] } }));
    if (kind === 'allowed') setNewAllowedDomain(''); else setNewBlockedDomain('');
  };
  const removeDomain = (kind: 'allowed' | 'blocked', value: string) => {
    const key = kind === 'allowed' ? 'allowed_email_domains' : 'blocked_email_domains';
    setPol(p => ({ ...p, login: { ...p.login, [key]: p.login[key].filter(d => d !== value) } }));
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  if (!isAdmin) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 flex items-start gap-3">
      <ShieldX className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-amber-700 dark:text-amber-300">Admins only</p>
        <p className="text-sm text-amber-700/70 dark:text-amber-300/70">Login & security policy is editable by admins.</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Lock className="w-5 h-5 text-violet-600" />Login & Security Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Workspace-wide rules for passwords, sessions, two-factor and network access. Changes apply on the next login.
        </p>
      </div>

      {/* Password */}
      <Section icon={KeyRound} title="Password policy" extra={
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Strength</span>
          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all', passwordStrength.bar)} style={{ width: `${passwordStrength.pct}%` }} />
          </div>
          <span className={cn('text-xs font-semibold', passwordStrength.color)}>{passwordStrength.label}</span>
        </div>
      }>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Minimum length">
            <input type="number" min={6} max={128} className={inp} value={pol.password.min_length}
              onChange={e => setPol(p => ({ ...p, password: { ...p.password, min_length: Number(e.target.value) || 12 } }))} />
          </Field>
          <Field label="Max age (days)" hint="0 = never expires">
            <input type="number" min={0} max={3650} className={inp} value={pol.password.max_age_days}
              onChange={e => setPol(p => ({ ...p, password: { ...p.password, max_age_days: Number(e.target.value) || 0 } }))} />
          </Field>
          <Field label="Prevent reuse" hint="Number of past passwords remembered">
            <input type="number" min={0} max={24} className={inp} value={pol.password.prevent_reuse_count}
              onChange={e => setPol(p => ({ ...p, password: { ...p.password, prevent_reuse_count: Number(e.target.value) || 0 } }))} />
          </Field>
        </div>

        <div className="space-y-1 pt-2">
          <ToggleRow label="Require uppercase letter" checked={pol.password.require_uppercase}
            onChange={v => setPol(p => ({ ...p, password: { ...p.password, require_uppercase: v } }))} />
          <ToggleRow label="Require number" checked={pol.password.require_number}
            onChange={v => setPol(p => ({ ...p, password: { ...p.password, require_number: v } }))} />
          <ToggleRow label="Require symbol" checked={pol.password.require_symbol}
            onChange={v => setPol(p => ({ ...p, password: { ...p.password, require_symbol: v } }))} />
        </div>
      </Section>

      {/* 2FA */}
      <Section icon={ShieldCheck} title="Two-factor authentication">
        <Field label="Enforcement">
          <select className={inp} value={pol.two_factor.enforcement}
            onChange={e => setPol(p => ({ ...p, two_factor: { ...p.two_factor, enforcement: e.target.value as Policy['two_factor']['enforcement'] } }))}>
            <option value="off">Off — users cannot enable 2FA</option>
            <option value="optional">Optional — users may opt in</option>
            <option value="required">Required — every user must set it up</option>
          </select>
        </Field>
        {pol.two_factor.enforcement === 'required' && (
          <Field label="Grace period (days)" hint="Existing users get this many days to set up 2FA before being locked out">
            <input type="number" min={0} max={90} className={inp} value={pol.two_factor.grace_period_days}
              onChange={e => setPol(p => ({ ...p, two_factor: { ...p.two_factor, grace_period_days: Number(e.target.value) || 0 } }))} />
          </Field>
        )}
      </Section>

      {/* Sessions */}
      <Section icon={Clock} title="Sessions">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Idle timeout (min)" hint="0 = never">
            <input type="number" min={0} max={1440} className={inp} value={pol.session.idle_timeout_minutes}
              onChange={e => setPol(p => ({ ...p, session: { ...p.session, idle_timeout_minutes: Number(e.target.value) || 0 } }))} />
          </Field>
          <Field label="Max lifetime (hours)" hint="Hard cap regardless of activity">
            <input type="number" min={1} max={720} className={inp} value={pol.session.max_lifetime_hours}
              onChange={e => setPol(p => ({ ...p, session: { ...p.session, max_lifetime_hours: Number(e.target.value) || 24 } }))} />
          </Field>
          <Field label="Max concurrent" hint="0 = unlimited">
            <input type="number" min={0} max={50} className={inp} value={pol.session.max_concurrent}
              onChange={e => setPol(p => ({ ...p, session: { ...p.session, max_concurrent: Number(e.target.value) || 0 } }))} />
          </Field>
        </div>
      </Section>

      {/* IP allowlist */}
      <Section icon={Globe} title={`IP allowlist (${pol.network.ip_allowlist.length})`}>
        <ToggleRow
          label="Restrict access to listed IPs"
          desc="Logins from outside the listed CIDR ranges are blocked. Add at least one entry before enabling."
          checked={pol.network.ip_allowlist_enabled}
          onChange={v => setPol(p => ({ ...p, network: { ...p.network, ip_allowlist_enabled: v } }))}
          disabled={pol.network.ip_allowlist.length === 0}
          danger
        />

        {pol.network.ip_allowlist_enabled && pol.network.ip_allowlist.length === 0 && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 p-3 flex items-start gap-2 text-xs">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-red-700 dark:text-red-300">
              Allowlist is on but no IPs are listed. Save will lock everyone out — add your office IP first.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <input className={inp} placeholder="e.g. 203.0.113.0/24" value={newIp}
            onChange={e => setNewIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addIp())} />
          <button type="button" onClick={addIp}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {pol.network.ip_allowlist.length > 0 && (
          <div className="rounded-lg border border-border divide-y divide-border max-h-60 overflow-y-auto">
            {pol.network.ip_allowlist.map(ip => (
              <div key={ip} className="flex items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors">
                <code className="text-xs font-mono">{ip}</code>
                <button onClick={() => removeIp(ip)} className="p-1 text-muted-foreground hover:text-red-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Login domains */}
      <Section icon={Lock} title="Login & sign-up">
        <ToggleRow
          label="Allow self-signup"
          desc="Anyone with a valid email can create an account in this workspace. Off = invite only."
          checked={pol.login.allow_self_signup}
          onChange={v => setPol(p => ({ ...p, login: { ...p.login, allow_self_signup: v } }))}
        />

        <DomainList
          label="Allowed email domains"
          hint="If empty, all domains are allowed. If non-empty, only listed domains can sign in."
          domains={pol.login.allowed_email_domains}
          newValue={newAllowedDomain}
          setNewValue={setNewAllowedDomain}
          onAdd={() => addDomain('allowed')}
          onRemove={(d) => removeDomain('allowed', d)}
        />

        <DomainList
          label="Blocked email domains"
          hint="Always blocked, takes precedence over the allowlist."
          domains={pol.login.blocked_email_domains}
          newValue={newBlockedDomain}
          setNewValue={setNewBlockedDomain}
          onAdd={() => addDomain('blocked')}
          onRemove={(d) => removeDomain('blocked', d)}
          danger
        />
      </Section>

      {/* Save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button onClick={() => setPol(original)}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

function Section({ icon: Icon, title, extra, children }: { icon: any; title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {title}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-1">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange, disabled, danger }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-1', disabled && 'opacity-50')}>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', danger && checked && 'text-red-700 dark:text-red-400')}>{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5',
          checked ? (danger ? 'bg-red-600' : 'bg-violet-600') : 'bg-muted',
          disabled && 'cursor-not-allowed'
        )}>
        <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1')} />
      </button>
    </div>
  );
}

function DomainList({ label, hint, domains, newValue, setNewValue, onAdd, onRemove, danger }: {
  label: string; hint?: string; domains: string[];
  newValue: string; setNewValue: (v: string) => void; onAdd: () => void; onRemove: (d: string) => void; danger?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="flex gap-2">
        <input className={inp} placeholder="e.g. acme.com" value={newValue}
          onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), onAdd())} />
        <button type="button" onClick={onAdd}
          className="flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground/70 mt-1">{hint}</p>}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {domains.map(d => (
            <span key={d} className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-mono',
              danger ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400' : 'bg-muted text-foreground'
            )}>
              {d}
              <button onClick={() => onRemove(d)} className="hover:text-foreground/80"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
