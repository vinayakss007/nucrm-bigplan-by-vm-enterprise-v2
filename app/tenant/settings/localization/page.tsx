'use client';
import { useEffect, useMemo, useState } from 'react';
import { Globe, Clock, DollarSign, Calendar, Briefcase, Plus, X, Save, Loader2, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Holiday = { date: string; name: string };
type BusinessHours = { enabled: boolean; start_time: string; end_time: string; working_days: string[] };
type Loc = {
  timezone: string;
  currency: string;
  fiscal_year_start_month: number;
  week_start: 'sunday' | 'monday' | 'saturday';
  weekend_days: string[];
  business_hours: BusinessHours;
  holidays: Holiday[];
  number_format: string;
};

const DEFAULTS: Loc = {
  timezone: 'UTC',
  currency: 'USD',
  fiscal_year_start_month: 1,
  week_start: 'sunday',
  weekend_days: ['saturday', 'sunday'],
  business_hours: { enabled: false, start_time: '09:00', end_time: '17:00', working_days: ['monday','tuesday','wednesday','thursday','friday'] },
  holidays: [],
  number_format: '1,234.56',
};

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'America/Mexico_City', 'America/Toronto',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Moscow',
  'Africa/Johannesburg', 'Africa/Cairo',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Sydney', 'Pacific/Auckland',
];
const CURRENCIES = ['USD','EUR','GBP','INR','AED','SGD','AUD','CAD','JPY','CNY','MXN','BRL','ZAR','CHF','SEK','NOK'];
const WEEKDAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function LocalizationPage() {
  const [loc, setLoc] = useState<Loc>(DEFAULTS);
  const [original, setOriginal] = useState<Loc>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(true);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '' });

  useEffect(() => {
  let ignore = false;
    Promise.all([
      fetch('/api/tenant/admin/localization').then(r => r.ok ? r.json() : { localization: DEFAULTS }),
      fetch('/api/tenant/me').then(r => r.ok ? r.json() : {}),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([d, me]: any[]) => { if (ignore) return; 
      const l = { ...DEFAULTS, ...(d.localization ?? { } ) };
      setLoc(l); setOriginal(l);
      setIsAdmin(me?.is_admin ?? false);
    }).finally(() => setLoading(false));
    return () => { ignore = true; };
}, []);

  const dirty = useMemo(() => JSON.stringify(loc) !== JSON.stringify(original), [loc, original]);

  const toggleWeekendDay = (d: string) => {
    setLoc(p => ({
      ...p,
      weekend_days: p.weekend_days.includes(d) ? p.weekend_days.filter(x => x !== d) : [...p.weekend_days, d],
    }));
  };
  const toggleWorkingDay = (d: string) => {
    setLoc(p => ({
      ...p,
      business_hours: {
        ...p.business_hours,
        working_days: p.business_hours.working_days.includes(d)
          ? p.business_hours.working_days.filter(x => x !== d)
          : [...p.business_hours.working_days, d],
      },
    }));
  };
  const addHoliday = () => {
    if (!newHoliday.date || !newHoliday.name.trim()) return;
    setLoc(p => ({
      ...p,
      holidays: [...p.holidays, { date: newHoliday.date, name: newHoliday.name.trim() }]
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setNewHoliday({ date: '', name: '' });
  };
  const removeHoliday = (date: string, name: string) => {
    setLoc(p => ({ ...p, holidays: p.holidays.filter(h => !(h.date === date && h.name === name)) }));
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/tenant/admin/localization', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localization: loc }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success('Localization saved');
      setOriginal(loc);
    } else {
      toast.error(d.error || 'Failed to save');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  if (!isAdmin) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 flex items-start gap-3">
      <ShieldX className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold text-amber-700 dark:text-amber-300">Admins only</p>
        <p className="text-sm text-amber-700/70 dark:text-amber-300/70">Workspace localization is editable by admins.</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Globe className="w-5 h-5 text-violet-600" />Localization</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Workspace-wide defaults for time, money, and the working calendar. Individual users may override their own preferences.
        </p>
      </div>

      <Section icon={Clock} title="Time & date">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Default timezone">
            <select className={inp} value={loc.timezone} onChange={e => setLoc(p => ({ ...p, timezone: e.target.value }))}>
              {TIMEZONES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Week starts on">
            <select className={inp} value={loc.week_start}
              onChange={e => setLoc(p => ({ ...p, week_start: e.target.value as Loc['week_start'] }))}>
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
              <option value="saturday">Saturday</option>
            </select>
          </Field>
          <Field label="Fiscal year starts">
            <select className={inp} value={loc.fiscal_year_start_month}
              onChange={e => setLoc(p => ({ ...p, fiscal_year_start_month: Number(e.target.value) }))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Weekend">
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map(d => (
                <button key={d} type="button" onClick={() => toggleWeekendDay(d)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors capitalize',
                    loc.weekend_days.includes(d)
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}>
                  {d.slice(0, 3)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Section>

      <Section icon={DollarSign} title="Money & numbers">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Default currency" hint="Used for new deals and invoices.">
            <select className={inp} value={loc.currency} onChange={e => setLoc(p => ({ ...p, currency: e.target.value }))}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Number format">
            <select className={inp} value={loc.number_format} onChange={e => setLoc(p => ({ ...p, number_format: e.target.value }))}>
              <option value="1,234.56">1,234.56  (US / UK)</option>
              <option value="1.234,56">1.234,56  (EU)</option>
              <option value="1 234,56">1 234,56  (FR / Nordic)</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section icon={Briefcase} title="Business hours">
        <div className="space-y-3">
          <ToggleRow
            label="Define working hours"
            desc="SLA timers, automation rules and round-robin assignment can pause outside these hours."
            checked={loc.business_hours.enabled}
            onChange={v => setLoc(p => ({ ...p, business_hours: { ...p.business_hours, enabled: v } }))}
          />
          {loc.business_hours.enabled && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Start">
                  <input type="time" className={inp} value={loc.business_hours.start_time}
                    onChange={e => setLoc(p => ({ ...p, business_hours: { ...p.business_hours, start_time: e.target.value } }))} />
                </Field>
                <Field label="End">
                  <input type="time" className={inp} value={loc.business_hours.end_time}
                    onChange={e => setLoc(p => ({ ...p, business_hours: { ...p.business_hours, end_time: e.target.value } }))} />
                </Field>
              </div>
              <Field label="Working days">
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map(d => (
                    <button key={d} type="button" onClick={() => toggleWorkingDay(d)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors capitalize',
                        loc.business_hours.working_days.includes(d)
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      )}>
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section icon={Calendar} title={`Holidays (${loc.holidays.length})`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input type="date" className={inp} value={newHoliday.date}
            onChange={e => setNewHoliday(p => ({ ...p, date: e.target.value }))} />
          <input className={cn(inp, 'md:col-span-1')} placeholder="Holiday name (e.g. Independence Day)"
            value={newHoliday.name}
            onChange={e => setNewHoliday(p => ({ ...p, name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addHoliday())} />
          <button type="button" onClick={addHoliday} disabled={!newHoliday.date || !newHoliday.name.trim()}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add holiday
          </button>
        </div>

        {loc.holidays.length > 0 && (
          <div className="mt-3 rounded-lg border border-border divide-y divide-border max-h-72 overflow-y-auto">
            {loc.holidays.map(h => (
              <div key={`${h.date}-${h.name}`} className="flex items-center justify-between px-3 py-2 hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">{h.date}</span>
                  <span className="text-sm truncate">{h.name}</span>
                </div>
                <button type="button" onClick={() => removeHoliday(h.date, h.name)}
                  className="p-1 text-muted-foreground hover:text-red-600 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {loc.holidays.length === 0 && (
          <p className="text-xs text-muted-foreground mt-2">No holidays yet. Add country-specific dates to skip them in business-hours calculations.</p>
        )}
      </Section>

      {/* Save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button onClick={() => setLoc(original)}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save localization'}
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
