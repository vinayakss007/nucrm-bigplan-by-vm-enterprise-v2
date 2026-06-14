'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell, Mail, MessageSquare, UserCheck, TrendingUp, CheckSquare, LifeBuoy,
  AtSign, Users, ShieldCheck, Receipt, Save, Loader2, RotateCcw, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type Channel = 'in_app' | 'email' | 'telegram';
type Matrix = Record<string, Record<Channel, boolean>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CHANNEL_META: Record<Channel, { label: string; icon: any }> = {
  in_app:   { label: 'In-app',   icon: Bell },
  email:    { label: 'Email',    icon: Mail },
  telegram: { label: 'Telegram', icon: MessageSquare },
};

type EventDef = { key: string; label: string; desc: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Group = { label: string; icon: any; events: EventDef[] };

const GROUPS: Group[] = [
  {
    label: 'Leads', icon: UserCheck, events: [
      { key: 'lead.created',          label: 'New lead created',         desc: 'When anyone in the workspace adds a lead' },
      { key: 'lead.assigned_to_me',   label: 'Lead assigned to me',      desc: 'When a lead is routed to you' },
      { key: 'lead.status_changed',   label: 'Lead status changes',      desc: 'Stage transitions on leads you own' },
    ],
  },
  {
    label: 'Contacts', icon: Users, events: [
      { key: 'contact.created',        label: 'New contact created',     desc: 'Someone added a contact' },
      { key: 'contact.mentioned_me',   label: 'Contact mentions me',     desc: 'When you are mentioned in a contact note' },
    ],
  },
  {
    label: 'Deals', icon: TrendingUp, events: [
      { key: 'deal.created',                  label: 'New deal created',          desc: '' },
      { key: 'deal.assigned_to_me',           label: 'Deal assigned to me',       desc: '' },
      { key: 'deal.stage_changed',            label: 'Deal stage moved',          desc: 'On deals you own' },
      { key: 'deal.won',                      label: 'Deal won',                  desc: 'Across the workspace' },
      { key: 'deal.lost',                     label: 'Deal lost',                 desc: 'Across the workspace' },
      { key: 'deal.close_date_approaching',   label: 'Close date approaching',    desc: '7 days out, on your deals' },
    ],
  },
  {
    label: 'Tasks', icon: CheckSquare, events: [
      { key: 'task.assigned_to_me', label: 'Task assigned to me', desc: '' },
      { key: 'task.due_today',      label: 'Task due today',      desc: 'Daily morning summary' },
      { key: 'task.overdue',        label: 'Task overdue',        desc: 'Daily reminder until completed' },
    ],
  },
  {
    label: 'Helpdesk', icon: LifeBuoy, events: [
      { key: 'ticket.created',         label: 'New ticket',           desc: '' },
      { key: 'ticket.assigned_to_me',  label: 'Ticket assigned to me', desc: '' },
      { key: 'ticket.replied',         label: 'Ticket replied',       desc: 'Customer replied to your ticket' },
    ],
  },
  {
    label: 'Mentions & Replies', icon: AtSign, events: [
      { key: 'comment.mentioned_me', label: 'Mentioned in a comment', desc: '@you anywhere in the app' },
      { key: 'comment.replied',      label: 'Reply to my comment',    desc: '' },
    ],
  },
  {
    label: 'Team', icon: Users, events: [
      { key: 'team.invite_accepted', label: 'Invite accepted', desc: 'When someone you invited joins' },
      { key: 'team.role_changed',    label: 'My role changed', desc: '' },
    ],
  },
  {
    label: 'Security', icon: ShieldCheck, events: [
      { key: 'security.login_new_device',  label: 'Login from new device', desc: 'Recommended: keep on' },
      { key: 'security.password_changed',  label: 'Password changed',      desc: '' },
      { key: 'security.two_factor_changed', label: 'Two-factor changed',   desc: '' },
    ],
  },
  {
    label: 'Billing', icon: Receipt, events: [
      { key: 'billing.trial_ending',  label: 'Trial ending',  desc: '7 / 3 / 1 day before' },
      { key: 'billing.payment_failed', label: 'Payment failed', desc: '' },
      { key: 'billing.plan_changed',   label: 'Plan changed',   desc: '' },
    ],
  },
];

export default function NotificationsPage() {
  const [matrix, setMatrix] = useState<Matrix>({});
  const [original, setOriginal] = useState<Matrix>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
  let ignore = false;
    fetch('/api/tenant/notifications/matrix')
      .then(r => r.ok ? r.json() : { matrix: {} })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then((d: any) => {
        setMatrix(d.matrix ?? {});
        setOriginal(d.matrix ?? {});
      })
      .finally(() => setLoading(false));
    return () => { ignore = true; };
}, []);

  const dirty = JSON.stringify(matrix) !== JSON.stringify(original);

  const setCell = (eventKey: string, channel: Channel, value: boolean) => {
    setMatrix(prev => ({
      ...prev,
      [eventKey]: { ...(prev[eventKey] ?? { in_app:false, email:false, telegram:false }), [channel]: value },
    }));
  };

  const toggleColumn = (channel: Channel, on: boolean) => {
    setMatrix(prev => {
      const next: Matrix = {};
      for (const key of Object.keys(prev)) {
        next[key] = { ...prev[key]!, [channel]: on };
      }
      return next;
    });
  };

  const toggleRow = (eventKey: string, on: boolean) => {
    setMatrix(prev => ({
      ...prev,
      [eventKey]: { in_app: on, email: on, telegram: on },
    }));
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/tenant/notifications/matrix', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matrix }),
    });
    const d = await res.json();
    if (res.ok) {
      toast.success(`Saved ${d.count ?? 0} notification rules`);
      setOriginal(matrix);
    } else {
      toast.error(d.error || 'Failed to save');
    }
    setSaving(false);
  };

  const q = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return GROUPS;
    return GROUPS
      .map(g => ({ ...g, events: g.events.filter(ev =>
        ev.label.toLowerCase().includes(q) ||
        ev.desc.toLowerCase().includes(q) ||
        ev.key.toLowerCase().includes(q)
      ) }))
      .filter(g => g.events.length > 0);
  }, [q]);

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Control which events reach you and through which channel.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search events…"
            className="pl-8 pr-3 py-1.5 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/40 w-64"
          />
        </div>
      </div>

      {/* Channel column toggles */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick toggles</p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CHANNEL_META) as Channel[]).map(ch => {
            const Icon = CHANNEL_META[ch].icon;
            return (
              <div key={ch} className="flex items-center gap-1 border border-border rounded-lg overflow-hidden text-xs">
                <span className="px-2.5 py-1.5 flex items-center gap-1.5 font-semibold bg-muted/30">
                  <Icon className="w-3.5 h-3.5" />
                  {CHANNEL_META[ch].label}
                </span>
                <button onClick={() => toggleColumn(ch, true)}
                  className="px-2 py-1.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 font-medium border-l border-border">
                  All on
                </button>
                <button onClick={() => toggleColumn(ch, false)}
                  className="px-2 py-1.5 hover:bg-red-50 dark:hover:bg-red-950/30 text-red-600 dark:text-red-400 font-medium border-l border-border">
                  All off
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Matrix */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_repeat(3,_80px)_40px] items-center px-4 py-3 border-b border-border bg-muted/20 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <div>Event</div>
          {(Object.keys(CHANNEL_META) as Channel[]).map(ch => {
            const Icon = CHANNEL_META[ch].icon;
            return (
              <div key={ch} className="flex flex-col items-center gap-0.5">
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[10px] normal-case font-semibold">{CHANNEL_META[ch].label}</span>
              </div>
            );
          })}
          <div className="text-center text-[10px] normal-case font-semibold">Row</div>
        </div>

        {filteredGroups.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No events match "{query}"</div>
        )}

        {filteredGroups.map(group => {
          const GroupIcon = group.icon;
          return (
            <div key={group.label}>
              <div className="px-4 py-2 bg-muted/10 border-b border-border flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <GroupIcon className="w-3.5 h-3.5" />
                {group.label}
              </div>
              {group.events.map(ev => {
                const row = matrix[ev.key] ?? { in_app:false, email:false, telegram:false };
                const allOn = row.in_app && row.email && row.telegram;
                const allOff = !row.in_app && !row.email && !row.telegram;
                return (
                  <div key={ev.key}
                    className="grid grid-cols-[1fr_repeat(3,_80px)_40px] items-center px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors">
                    <div className="min-w-0 pr-3">
                      <p className="text-sm font-medium truncate">{ev.label}</p>
                      {ev.desc && <p className="text-[11px] text-muted-foreground truncate">{ev.desc}</p>}
                    </div>
                    {(Object.keys(CHANNEL_META) as Channel[]).map(ch => (
                      <div key={ch} className="flex items-center justify-center">
                        <Toggle checked={row[ch]} onChange={v => setCell(ev.key, ch, v)} />
                      </div>
                    ))}
                    <div className="flex items-center justify-center">
                      <button
                        onClick={() => toggleRow(ev.key, allOff ? true : !allOn)}
                        title={allOff ? 'Enable all' : allOn ? 'Disable all' : 'Toggle all'}
                        className="text-[10px] text-muted-foreground hover:text-foreground font-medium px-1.5 py-0.5 rounded hover:bg-accent transition-colors">
                        {allOff ? 'On' : allOn ? 'Off' : '~'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Sticky save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button type="button" onClick={() => setMatrix(original)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <RotateCcw className="w-3.5 h-3.5" /> Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-violet-600' : 'bg-muted'
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1'
        )}
      />
    </button>
  );
}
