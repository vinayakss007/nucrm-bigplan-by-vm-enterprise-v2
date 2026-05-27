'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  Save, Globe, Palette, Calendar, Clock, LayoutDashboard, Loader2, RotateCcw,
  Type, Eye, Sparkles, Keyboard, Bell, Mail, Lock, EyeOff, Zap, Search,
  PanelLeftClose, MousePointerClick, Filter, Lightbulb, ShieldCheck, AlertCircle,
  Hash, FileText,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import SidebarCustomizeSection from '@/components/tenant/settings/sidebar-customize-section';

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

const ACCENT_COLORS: { value: string; hex: string; label: string }[] = [
  { value: 'violet',  hex: '#7c3aed', label: 'Violet' },
  { value: 'indigo',  hex: '#6366f1', label: 'Indigo' },
  { value: 'blue',    hex: '#3b82f6', label: 'Blue' },
  { value: 'cyan',    hex: '#06b6d4', label: 'Cyan' },
  { value: 'emerald', hex: '#10b981', label: 'Emerald' },
  { value: 'amber',   hex: '#f59e0b', label: 'Amber' },
  { value: 'rose',    hex: '#f43f5e', label: 'Rose' },
  { value: 'slate',   hex: '#64748b', label: 'Slate' },
];

const LANDING = [
  { value: '/tenant/dashboard', label: 'Dashboard' },
  { value: '/tenant/leads',     label: 'Leads' },
  { value: '/tenant/contacts',  label: 'Contacts' },
  { value: '/tenant/deals',     label: 'Deals' },
  { value: '/tenant/tasks',     label: 'Tasks' },
  { value: '/tenant/calendar',  label: 'Calendar' },
  { value: '/tenant/tickets',   label: 'Helpdesk' },
];

const SECTIONS = [
  { id: 'appearance',    label: 'Appearance',     icon: Palette },
  { id: 'datetime',      label: 'Date & Time',    icon: Clock },
  { id: 'productivity',  label: 'Productivity',   icon: Zap },
  { id: 'communication', label: 'Communication',  icon: Mail },
  { id: 'privacy',       label: 'Privacy',        icon: Lock },
  { id: 'sidebar',       label: 'Sidebar',        icon: PanelLeftClose },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

type Prefs = Record<string, any>;

export default function PreferencesPage() {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [original, setOriginal] = useState<Prefs>({});
  const [workspaceDefaults, setWorkspaceDefaults] = useState<Prefs>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('appearance');
  const [query, setQuery] = useState('');
  const { setTheme } = useTheme();

  useEffect(() => {
    fetch('/api/user/preferences')
      .then(r => r.ok ? r.json() : { preferences: {}, workspace_defaults: {} })
      .then(d => {
        setPrefs(d.preferences ?? {});
        setOriginal(d.preferences ?? {});
        setWorkspaceDefaults(d.workspace_defaults ?? {});
      })
      .finally(() => setLoading(false));
  }, []);

  const dirty = useMemo(() => JSON.stringify(prefs) !== JSON.stringify(original), [prefs, original]);

  const set = (k: string, v: any) => setPrefs(p => ({ ...p, [k]: v }));

  const save = async () => {
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
      setTheme(prefs['theme']);
      // Notify the global applier to reapply data attributes
      window.dispatchEvent(new Event('nucrm:prefs-changed'));
    } else {
      toast.error(d.error || 'Failed to save');
    }
    setSaving(false);
  };

  const resetToWorkspace = async () => {
    if (!window.confirm('Reset all your preferences to the workspace defaults?')) return;
    setSaving(true);
    const res = await fetch('/api/user/preferences', { method: 'DELETE' });
    if (res.ok) {
      toast.success('Reset to workspace defaults');
      const refresh = await fetch('/api/user/preferences');
      const d = await refresh.json();
      setPrefs(d.preferences ?? {}); setOriginal(d.preferences ?? {});
      window.dispatchEvent(new Event('nucrm:prefs-changed'));
    } else {
      toast.error('Failed to reset');
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const q = query.trim().toLowerCase();

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Preferences</h1>
          <p className="text-sm text-muted-foreground mt-1">
            How NuCRM looks and behaves for you. Workspace admins set defaults; your settings override them.
          </p>
        </div>
        <button onClick={resetToWorkspace} type="button"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5">
          <RotateCcw className="w-3 h-3" /> Reset to workspace defaults
        </button>
      </div>

      {/* Search + section pills */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search preferences…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 overflow-x-auto sm:overflow-visible scrollbar-thin">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border whitespace-nowrap transition-colors',
                activeSection === s.id
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              )}>
              <s.icon className="w-3.5 h-3.5" />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sections */}
      {(activeSection === 'appearance' || q) && (
        <Section icon={Palette} title="Appearance" hidden={!!(q && !match('appearance theme font dark light density accent color motion contrast sidebar avatar', q))}>
          <Field label="Language">
            <select className={inp} value={prefs['locale'] ?? 'en'} onChange={e => set('locale', e.target.value)}>
              {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>

          <Field label="Theme">
            <RadioGroup value={prefs['theme'] ?? 'system'} onChange={v => set('theme', v)}
              options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
          </Field>

          <Field label="Font size" hint="Large helps readability on smaller screens or for long sessions.">
            <RadioGroup value={prefs['font_size'] ?? 'normal'} onChange={v => set('font_size', v)}
              options={[
                { value: 'small',  label: 'Small',  className: 'text-[11px]' },
                { value: 'normal', label: 'Normal', className: 'text-[13px]' },
                { value: 'large',  label: 'Large',  className: 'text-[15px]' },
                { value: 'xl',     label: 'XL',     className: 'text-[17px]' },
              ]} />
          </Field>

          <Field label="UI density" hint="How tightly information is packed">
            <RadioGroup value={prefs['ui_density'] ?? 'cozy'} onChange={v => set('ui_density', v)}
              options={[{ value: 'compact', label: 'Compact' }, { value: 'cozy', label: 'Cozy' }, { value: 'comfy', label: 'Comfortable' }]} />
          </Field>

          <Field label="Accent colour" hint="Replaces violet across primary buttons & highlights.">
            <div className="flex flex-wrap gap-1.5">
              {ACCENT_COLORS.map(c => (
                <button key={c.value} type="button" onClick={() => set('accent_color', c.value)}
                  className={cn(
                    'w-9 h-9 rounded-lg border-2 transition-all flex items-center justify-center',
                    prefs['accent_color'] === c.value ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                  )}
                  title={c.label}
                  style={{ background: c.hex }}>
                  {prefs['accent_color'] === c.value && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Sidebar default">
            <RadioGroup value={prefs['sidebar_default'] ?? 'expanded'} onChange={v => set('sidebar_default', v)}
              options={[{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Collapsed' }]} />
          </Field>

          <ToggleRow label="Show avatars in lists" checked={prefs['show_avatars'] !== false}
            onChange={v => set('show_avatars', v)}
            desc="Profile pictures next to names in tables and cards." />

          <ToggleRow label="Reduce motion" checked={prefs['reduce_motion'] === true}
            onChange={v => set('reduce_motion', v)}
            desc="Disable animations and transitions across the app." />

          <ToggleRow label="High contrast" checked={prefs['high_contrast'] === true}
            onChange={v => set('high_contrast', v)}
            desc="Stronger borders and focus rings for better visibility." />
        </Section>
      )}

      {(activeSection === 'datetime' || q) && (
        <Section icon={Calendar} title="Date & time" hidden={!!(q && !match('date time week format calendar fiscal', q))}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Date format">
              <select className={inp} value={prefs['date_format'] ?? 'MM/DD/YYYY'} onChange={e => set('date_format', e.target.value)}>
                <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (UK / EU)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
              </select>
            </Field>
            <Field label="Time format">
              <select className={inp} value={prefs['time_format'] ?? '12h'} onChange={e => set('time_format', e.target.value)}>
                <option value="12h">12-hour (AM/PM)</option>
                <option value="24h">24-hour</option>
              </select>
            </Field>
            <Field label="Week starts on">
              <select className={inp} value={prefs['week_start'] ?? 'sunday'} onChange={e => set('week_start', e.target.value)}>
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </Field>
          </div>
          <Field label="Default calendar view">
            <RadioGroup value={prefs['default_calendar_view'] ?? 'week'} onChange={v => set('default_calendar_view', v)}
              options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} />
          </Field>
        </Section>
      )}

      {(activeSection === 'productivity' || q) && (
        <Section icon={Zap} title="Productivity" hidden={!!(q && !match('landing default page size view confirm keyboard shortcut link tab filter tip autosave', q))}>
          <Field label="Landing page after login">
            <select className={inp} value={prefs['default_landing'] ?? '/tenant/dashboard'} onChange={e => set('default_landing', e.target.value)}>
              {LANDING.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Default record view">
              <RadioGroup value={prefs['default_record_view'] ?? 'list'} onChange={v => set('default_record_view', v)}
                options={[{ value: 'list', label: 'List' }, { value: 'kanban', label: 'Kanban' }, { value: 'card', label: 'Card' }, { value: 'calendar', label: 'Calendar' }]} />
            </Field>
            <Field label="Default page size">
              <RadioGroup value={String(prefs['default_page_size'] ?? 25)}
                onChange={v => set('default_page_size', Number(v))}
                options={[{ value: '10', label: '10' }, { value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' }]} />
            </Field>
          </div>

          <Field label="Confirm destructive actions" hint="Always = confirm even small deletions. Danger only = bulk-delete & permanent ops.">
            <RadioGroup value={prefs['confirm_destructive'] ?? 'always'} onChange={v => set('confirm_destructive', v)}
              options={[{ value: 'always', label: 'Always' }, { value: 'danger_only', label: 'Danger only' }, { value: 'never', label: 'Never' }]} />
          </Field>

          <ToggleRow label="Keyboard shortcuts"
            desc="⌘K palette, g+d Dashboard, n+c New contact, ? for full list."
            checked={prefs['keyboard_shortcuts_enabled'] !== false}
            onChange={v => set('keyboard_shortcuts_enabled', v)} />
          <ToggleRow label="Auto-save form drafts"
            desc="Save in-progress edits in your browser if you navigate away."
            checked={prefs['autosave_drafts'] !== false}
            onChange={v => set('autosave_drafts', v)} />
          <ToggleRow label="Sticky filters"
            desc="Remember filters you applied on a list when you come back."
            checked={prefs['sticky_filters'] !== false}
            onChange={v => set('sticky_filters', v)} />
          <ToggleRow label="Open external links in new tab"
            checked={prefs['links_open_new_tab'] === true}
            onChange={v => set('links_open_new_tab', v)} />
          <ToggleRow label="Show tips & onboarding"
            desc="Hints and empty-state suggestions throughout the app."
            checked={prefs['show_tips'] !== false}
            onChange={v => set('show_tips', v)} />
          <ToggleRow label="Show keyboard hints in menus"
            checked={prefs['show_keyboard_hints'] !== false}
            onChange={v => set('show_keyboard_hints', v)} />
        </Section>
      )}

      {(activeSection === 'communication' || q) && (
        <Section icon={Mail} title="Communication" hidden={!!(q && !match('email signature tracking cc meeting duration calendar default', q))}>
          <Field label="Email signature" hint="Appended to outbound email from this CRM. Plain text or basic HTML, max 5,000 chars.">
            <textarea
              rows={5}
              className={inp}
              value={prefs['email_signature'] ?? ''}
              onChange={e => set('email_signature', e.target.value)}
              placeholder={`Best regards,\nYour Name\nYour Role`}
              maxLength={5000}
            />
            <p className="text-[11px] text-muted-foreground mt-1 text-right">
              {(prefs['email_signature'] ?? '').length} / 5,000
            </p>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Email tracking by default">
              <RadioGroup value={prefs['email_tracking_default'] ?? 'on'} onChange={v => set('email_tracking_default', v)}
                options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'ask', label: 'Ask each time' }]} />
            </Field>
            <Field label="Default meeting duration">
              <RadioGroup value={String(prefs['default_meeting_duration'] ?? 30)}
                onChange={v => set('default_meeting_duration', Number(v))}
                options={[{ value: '15', label: '15m' }, { value: '30', label: '30m' }, { value: '45', label: '45m' }, { value: '60', label: '60m' }, { value: '90', label: '90m' }]} />
            </Field>
          </div>
          <ToggleRow label="Auto-CC myself on outbound emails"
            desc="A copy of every email lands in your own inbox."
            checked={prefs['auto_cc_self'] === true}
            onChange={v => set('auto_cc_self', v)} />
        </Section>
      )}

      {(activeSection === 'privacy' || q) && (
        <Section icon={Lock} title="Privacy" hidden={!!(q && !match('privacy online status activity visible team manager', q))}>
          <Field label="Online status visible to">
            <RadioGroup value={prefs['online_status_visible'] ?? 'team'} onChange={v => set('online_status_visible', v)}
              options={[{ value: 'everyone', label: 'Everyone' }, { value: 'team', label: 'My team' }, { value: 'nobody', label: 'Nobody' }]} />
          </Field>
          <Field label="Activity feed visible to" hint="Records you created or edited that show up in others' activity streams.">
            <RadioGroup value={prefs['activity_visible_to'] ?? 'team'} onChange={v => set('activity_visible_to', v)}
              options={[{ value: 'everyone', label: 'Everyone' }, { value: 'team', label: 'Team' }, { value: 'managers', label: 'Managers' }, { value: 'nobody', label: 'Nobody' }]} />
          </Field>
        </Section>
      )}

      {(activeSection === 'sidebar' || q) && (
        <SidebarCustomizeSection
          hidden={!!(q && !match('sidebar nav navigation hide show role view', q))}
          hiddenItems={prefs['hidden_nav_items'] ?? []}
          onChange={(next: string[]) => set('hidden_nav_items', next)}
        />
      )}

      {Object.keys(workspaceDefaults).length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-3 flex items-start gap-2 text-xs">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
          <p className="text-muted-foreground">
            Your workspace admin has set <span className="font-semibold text-foreground">{Object.keys(workspaceDefaults).length}</span> default{Object.keys(workspaceDefaults).length === 1 ? '' : 's'}.
            Anything you change here only applies to you.
          </p>
        </div>
      )}

      {/* Sticky save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button onClick={() => setPrefs(original)} type="button"
          className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}

function match(corpus: string, q: string) {
  return corpus.toLowerCase().includes(q);
}

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

function Section({ icon: Icon, title, hidden, children }: { icon: any; title: string; hidden?: boolean; children: React.ReactNode }) {
  if (hidden) return null;
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

function RadioGroup<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string; className?: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap p-0.5 rounded-lg border border-border bg-muted/30 gap-0.5 max-w-full">
      {options.map(opt => (
        <button
          key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap',
            value === opt.value ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
            opt.className,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5',
          checked ? 'bg-violet-600' : 'bg-muted'
        )}>
        <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1')} />
      </button>
    </div>
  );
}
