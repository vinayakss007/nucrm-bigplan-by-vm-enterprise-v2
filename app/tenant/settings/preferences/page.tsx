'use client';
import { useState, useEffect } from 'react';
import { Save, Globe, Palette, Calendar, Clock, LayoutDashboard, MonitorDot, Loader2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

const LOCALES = [
  { value: 'en',    label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es',    label: 'Español' },
  { value: 'pt',    label: 'Português' },
  { value: 'fr',    label: 'Français' },
  { value: 'de',    label: 'Deutsch' },
  { value: 'it',    label: 'Italiano' },
  { value: 'nl',    label: 'Nederlands' },
  { value: 'ar',    label: 'العربية' },
  { value: 'hi',    label: 'हिन्दी' },
  { value: 'zh',    label: '中文' },
  { value: 'ja',    label: '日本語' },
];

const LANDING = [
  { value: '/tenant/dashboard', label: 'Dashboard' },
  { value: '/tenant/leads',     label: 'Leads' },
  { value: '/tenant/contacts',  label: 'Contacts' },
  { value: '/tenant/deals',     label: 'Deals' },
  { value: '/tenant/tasks',     label: 'Tasks' },
  { value: '/tenant/calendar',  label: 'Calendar' },
];

type Prefs = {
  locale: string;
  theme: string;
  ui_density: string;
  date_format: string;
  time_format: string;
  week_start: string;
  default_landing: string;
};

const DEFAULTS: Prefs = {
  locale: 'en',
  theme: 'system',
  ui_density: 'cozy',
  date_format: 'MM/DD/YYYY',
  time_format: '12h',
  week_start: 'sunday',
  default_landing: '/tenant/dashboard',
};

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [original, setOriginal] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { setTheme } = useTheme();

  useEffect(() => {
    fetch('/api/user/preferences')
      .then(r => r.ok ? r.json() : { preferences: DEFAULTS })
      .then(d => {
        setPrefs(d.preferences ?? DEFAULTS);
        setOriginal(d.preferences ?? DEFAULTS);
      })
      .finally(() => setLoading(false));
  }, []);

  const dirty = JSON.stringify(prefs) !== JSON.stringify(original);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('Preferences saved');
      setOriginal(prefs);
      // Apply theme immediately
      setTheme(prefs.theme);
    } else {
      toast.error(d.error || 'Failed to save');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold">Preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">
          How NuCRM looks and behaves for you. These settings apply only to your account.
        </p>
      </div>

      <form onSubmit={save} className="space-y-5">
        {/* Language & region */}
        <Section icon={Globe} title="Language & region">
          <Field label="Language">
            <select className={inp} value={prefs.locale} onChange={e => setPrefs(p => ({ ...p, locale: e.target.value }))}>
              {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
        </Section>

        {/* Appearance */}
        <Section icon={Palette} title="Appearance">
          <Field label="Theme">
            <RadioGroup
              value={prefs.theme}
              options={[
                { value: 'light',  label: 'Light' },
                { value: 'dark',   label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
              onChange={v => setPrefs(p => ({ ...p, theme: v }))}
            />
          </Field>
          <Field label="UI density" hint="How tightly information is packed">
            <RadioGroup
              value={prefs.ui_density}
              options={[
                { value: 'compact', label: 'Compact' },
                { value: 'cozy',    label: 'Cozy' },
                { value: 'comfy',   label: 'Comfortable' },
              ]}
              onChange={v => setPrefs(p => ({ ...p, ui_density: v }))}
            />
          </Field>
        </Section>

        {/* Date & time */}
        <Section icon={Calendar} title="Date & time">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Date format">
              <select className={inp} value={prefs.date_format} onChange={e => setPrefs(p => ({ ...p, date_format: e.target.value }))}>
                <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (UK / EU)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
              </select>
            </Field>
            <Field label="Time format">
              <select className={inp} value={prefs.time_format} onChange={e => setPrefs(p => ({ ...p, time_format: e.target.value }))}>
                <option value="12h">12-hour (AM/PM)</option>
                <option value="24h">24-hour</option>
              </select>
            </Field>
            <Field label="Week starts on">
              <select className={inp} value={prefs.week_start} onChange={e => setPrefs(p => ({ ...p, week_start: e.target.value }))}>
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </Field>
          </div>
        </Section>

        {/* Defaults */}
        <Section icon={LayoutDashboard} title="Defaults">
          <Field label="Landing page after login">
            <select className={inp} value={prefs.default_landing} onChange={e => setPrefs(p => ({ ...p, default_landing: e.target.value }))}>
              {LANDING.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>
        </Section>

        {/* Sticky save bar */}
        <div className={cn(
          'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
          dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}>
          <button type="button" onClick={() => setPrefs(original)}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            Discard
          </button>
          <button type="submit" disabled={saving || !dirty}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── helpers ──
const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="w-4 h-4 text-muted-foreground" />
        {title}
      </div>
      <div className="space-y-3">{children}</div>
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

function RadioGroup({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex p-0.5 rounded-lg border border-border bg-muted/30">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            value === opt.value
              ? 'bg-card shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
