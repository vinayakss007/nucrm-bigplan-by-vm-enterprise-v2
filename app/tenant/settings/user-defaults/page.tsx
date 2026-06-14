'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Settings as SettingsIcon, Save, Loader2, RotateCcw, ShieldX, AlertCircle,
  Palette, Calendar, Zap, Mail, Lock, Check, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const ACCENT_COLORS = [
  { value: 'violet',  hex: '#7c3aed', label: 'Violet' },
  { value: 'indigo',  hex: '#6366f1', label: 'Indigo' },
  { value: 'blue',    hex: '#3b82f6', label: 'Blue' },
  { value: 'cyan',    hex: '#06b6d4', label: 'Cyan' },
  { value: 'emerald', hex: '#10b981', label: 'Emerald' },
  { value: 'amber',   hex: '#f59e0b', label: 'Amber' },
  { value: 'rose',    hex: '#f43f5e', label: 'Rose' },
  { value: 'slate',   hex: '#64748b', label: 'Slate' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Defaults = Record<string, any>;

export default function UserDefaultsPage() {
  const [defaults, setDefaults] = useState<Defaults>({});
  const [original, setOriginal] = useState<Defaults>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);

  useEffect(() => {
  let ignore = false;
    Promise.all([
      fetch('/api/tenant/admin/user-defaults').then(r => r.ok ? r.json() : { user_defaults: {} }),
      fetch('/api/tenant/me').then(r => r.ok ? r.json() : {}),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([d, me]: any[]) => { if (ignore) return; 
      setDefaults(d.user_defaults ?? { } );
      setOriginal(d.user_defaults ?? {});
      setIsAdmin(me?.is_admin ?? false);
    }).finally(() => setLoading(false));
    return () => { ignore = true; };
}, []);

  const dirty = useMemo(() => JSON.stringify(defaults) !== JSON.stringify(original), [defaults, original]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setVal = (k: string, v: any) => setDefaults(p => {
    const next = { ...p };
    if (v === '' || v === null || v === undefined) delete next[k];
    else next[k] = v;
    return next;
  });

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/tenant/admin/user-defaults', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_defaults: defaults }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success(`Saved ${Object.keys(defaults).length} default(s)`);
      setOriginal(defaults);
    } else {
      toast.error(d.error || 'Failed');
    }
    setSaving(false);
  };

  const clearAll = async () => {
    if (!window.confirm('Remove every workspace user-default? Each user will fall back to platform defaults.')) return;
    setSaving(true);
    const res = await fetch('/api/tenant/admin/user-defaults', { method: 'DELETE' });
    if (res.ok) {
      toast.success('Workspace defaults cleared');
      setDefaults({}); setOriginal({});
    } else {
      toast.error('Failed');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  if (!isAdmin) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 flex items-start gap-3">
      <ShieldX className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-amber-700 dark:text-amber-300">Admins only</p>
        <p className="text-sm text-amber-700/70 dark:text-amber-300/70">User defaults are editable by admins.</p>
      </div>
    </div>
  );

  const setCount = Object.keys(defaults).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><SettingsIcon className="w-5 h-5 text-violet-600" />Workspace User Defaults</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Defaults applied to every member who hasn't customised their own preferences.
            Each user retains the right to override anything for themselves on the Preferences page.
          </p>
        </div>
        <button onClick={clearAll} disabled={setCount === 0 || saving}
          className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1.5 disabled:opacity-50">
          <RotateCcw className="w-3 h-3" /> Clear all defaults
        </button>
      </div>

      <div className="rounded-xl border border-dashed border-border p-3 flex items-start gap-2 text-xs">
        <AlertCircle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Resolution order: <span className="text-violet-600">user override</span> → <span className="text-amber-600">workspace default</span> → platform default.</p>
          <p className="text-muted-foreground mt-0.5">Leave a field blank here to hand it back to platform defaults. {setCount} default{setCount === 1 ? '' : 's'} currently set.</p>
        </div>
      </div>

      {/* Appearance defaults */}
      <Section icon={Palette} title="Appearance">
        <Field label="Default theme">
          <SelectOrUnset value={defaults['theme']} onChange={v => setVal('theme', v)}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System (follow OS)' }]} />
        </Field>
        <Field label="Default font size">
          <SelectOrUnset value={defaults['font_size']} onChange={v => setVal('font_size', v)}
            options={[{ value: 'small', label: 'Small' }, { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }, { value: 'xl', label: 'Extra Large' }]} />
        </Field>
        <Field label="Default UI density">
          <SelectOrUnset value={defaults['ui_density']} onChange={v => setVal('ui_density', v)}
            options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }, { value: 'comfy', label: 'Comfortable' }]} />
        </Field>
        <Field label="Default accent colour" hint="Replaces platform violet for everyone.">
          <div className="flex flex-wrap gap-1.5 items-center">
            <button type="button" onClick={() => setVal('accent_color', undefined)}
              className={cn('px-3 h-8 rounded-lg border text-xs font-medium transition-colors',
                !defaults['accent_color'] ? 'border-foreground bg-muted' : 'border-border text-muted-foreground hover:bg-accent')}>
              Unset
            </button>
            {ACCENT_COLORS.map(c => (
              <button key={c.value} type="button" onClick={() => setVal('accent_color', c.value)}
                className={cn(
                  'w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center',
                  defaults['accent_color'] === c.value ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                )}
                title={c.label} style={{ background: c.hex }}>
                {defaults['accent_color'] === c.value && <span className="w-2 h-2 rounded-full bg-white" />}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Default sidebar state">
          <SelectOrUnset value={defaults['sidebar_default']} onChange={v => setVal('sidebar_default', v)}
            options={[{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Collapsed' }]} />
        </Field>
      </Section>

      {/* Date / time defaults */}
      <Section icon={Calendar} title="Date & time">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Date format">
            <SelectOrUnset value={defaults['date_format']} onChange={v => setVal('date_format', v)}
              options={[{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' }, { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' }, { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' }]} />
          </Field>
          <Field label="Time format">
            <SelectOrUnset value={defaults['time_format']} onChange={v => setVal('time_format', v)}
              options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]} />
          </Field>
          <Field label="Week starts on">
            <SelectOrUnset value={defaults['week_start']} onChange={v => setVal('week_start', v)}
              options={[{ value: 'sunday', label: 'Sunday' }, { value: 'monday', label: 'Monday' }]} />
          </Field>
        </div>
      </Section>

      {/* Productivity */}
      <Section icon={Zap} title="Productivity">
        <Field label="Default landing page">
          <SelectOrUnset value={defaults['default_landing']} onChange={v => setVal('default_landing', v)}
            options={[
              { value: '/tenant/dashboard', label: 'Dashboard' },
              { value: '/tenant/leads',     label: 'Leads' },
              { value: '/tenant/contacts',  label: 'Contacts' },
              { value: '/tenant/deals',     label: 'Deals' },
              { value: '/tenant/tasks',     label: 'Tasks' },
              { value: '/tenant/calendar',  label: 'Calendar' },
              { value: '/tenant/tickets',   label: 'Helpdesk' },
            ]} />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Default record view">
            <SelectOrUnset value={defaults['default_record_view']} onChange={v => setVal('default_record_view', v)}
              options={[
                { value: 'list', label: 'List' }, { value: 'kanban', label: 'Kanban' },
                { value: 'card', label: 'Card' }, { value: 'calendar', label: 'Calendar' },
              ]} />
          </Field>
          <Field label="Default page size">
            <SelectOrUnset value={defaults['default_page_size'] != null ? String(defaults['default_page_size']) : undefined}
              onChange={v => setVal('default_page_size', v ? Number(v) : undefined)}
              options={[{ value: '10', label: '10' }, { value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' }]} />
          </Field>
        </div>
        <Field label="Confirm destructive actions">
          <SelectOrUnset value={defaults['confirm_destructive']} onChange={v => setVal('confirm_destructive', v)}
            options={[{ value: 'always', label: 'Always' }, { value: 'danger_only', label: 'Danger only' }, { value: 'never', label: 'Never' }]} />
        </Field>
        <BoolDefault label="Keyboard shortcuts on by default" k="keyboard_shortcuts_enabled" defaults={defaults} setVal={setVal} />
        <BoolDefault label="Sticky filters on by default" k="sticky_filters" defaults={defaults} setVal={setVal} />
        <BoolDefault label="Auto-save form drafts on by default" k="autosave_drafts" defaults={defaults} setVal={setVal} />
        <BoolDefault label="Show tips & onboarding on by default" k="show_tips" defaults={defaults} setVal={setVal} />
      </Section>

      {/* Communication */}
      <Section icon={Mail} title="Communication">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Email tracking by default">
            <SelectOrUnset value={defaults['email_tracking_default']} onChange={v => setVal('email_tracking_default', v)}
              options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'ask', label: 'Ask each time' }]} />
          </Field>
          <Field label="Default meeting duration">
            <SelectOrUnset value={defaults['default_meeting_duration'] != null ? String(defaults['default_meeting_duration']) : undefined}
              onChange={v => setVal('default_meeting_duration', v ? Number(v) : undefined)}
              options={[{ value: '15', label: '15m' }, { value: '30', label: '30m' }, { value: '45', label: '45m' }, { value: '60', label: '60m' }, { value: '90', label: '90m' }]} />
          </Field>
        </div>
        <Field label="Workspace email signature template" hint="Pre-fills new users' personal signature. They can edit it.">
          <textarea
            rows={4}
            className={inp}
            value={defaults['email_signature'] ?? ''}
            onChange={e => setVal('email_signature', e.target.value || undefined)}
            placeholder={`Best regards,\nThe Acme Team`}
            maxLength={5000}
          />
        </Field>
      </Section>

      {/* Privacy */}
      <Section icon={Lock} title="Privacy">
        <Field label="Default online-status visibility">
          <SelectOrUnset value={defaults['online_status_visible']} onChange={v => setVal('online_status_visible', v)}
            options={[{ value: 'everyone', label: 'Everyone' }, { value: 'team', label: 'Team' }, { value: 'nobody', label: 'Nobody' }]} />
        </Field>
        <Field label="Default activity-feed visibility">
          <SelectOrUnset value={defaults['activity_visible_to']} onChange={v => setVal('activity_visible_to', v)}
            options={[
              { value: 'everyone', label: 'Everyone' }, { value: 'team', label: 'Team' },
              { value: 'managers', label: 'Managers' }, { value: 'nobody', label: 'Nobody' },
            ]} />
        </Field>
      </Section>

      {/* Sticky save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button onClick={() => setDefaults(original)}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save defaults'}
        </button>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="w-4 h-4 text-muted-foreground" />
        {title}
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

function SelectOrUnset({ value, onChange, options }: { value: string | undefined; onChange: (v: string | undefined) => void; options: { value: string; label: string }[] }) {
  return (
    <select className={inp} value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}>
      <option value="">— Unset (use platform default) —</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function BoolDefault({ label, k, defaults, setVal }: {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  label: string; k: string; defaults: Defaults; setVal: (k: string, v: any) => void;
}) {
  const cur = defaults[k];
  const state = cur === true ? 'on' : cur === false ? 'off' : 'unset';
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <p className="text-sm">{label}</p>
      <div className="inline-flex p-0.5 rounded-lg border border-border bg-muted/30 gap-0.5">
        {[
          { v: 'unset', l: 'Unset' },
          { v: 'on',    l: 'On' },
          { v: 'off',   l: 'Off' },
        ].map(o => (
          <button key={o.v} type="button"
            onClick={() => setVal(k, o.v === 'unset' ? undefined : o.v === 'on')}
            className={cn(
              'px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors',
              state === o.v ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}>
            {o.l}
          </button>
        ))}
      </div>
    </div>
  );
}
