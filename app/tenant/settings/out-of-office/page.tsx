'use client';
import { useEffect, useState } from 'react';
import { Plane, Save, Loader2, Calendar, User, MessageSquare, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type OOO = {
  enabled: boolean;
  start_date: string | null;
  end_date: string | null;
  delegate_user_id: string | null;
  auto_reply: string;
  auto_reassign: boolean;
};

const DEFAULT: OOO = {
  enabled: false,
  start_date: null,
  end_date: null,
  delegate_user_id: null,
  auto_reply: '',
  auto_reassign: false,
};

export default function OutOfOfficePage() {
  const [ooo, setOoo] = useState<OOO>(DEFAULT);
  const [original, setOriginal] = useState<OOO>(DEFAULT);
  const [members, setMembers] = useState<{ user_id: string; full_name: string; email: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
  let ignore = false;
    Promise.all([
      fetch('/api/user/out-of-office').then(r => r.ok ? r.json() : { out_of_office: DEFAULT }),
      fetch('/api/tenant/members').then(r => r.ok ? r.json() : { data: [] }),
      fetch('/api/tenant/me').then(r => r.ok ? r.json() : {}),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).then(([oooRes, members, me]: any[]) => { if (ignore) return; 
      setOoo(oooRes.out_of_office ?? DEFAULT);
      setOriginal(oooRes.out_of_office ?? DEFAULT);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = (members.data ?? []).map((m: any) => ({
        user_id: m.userId, full_name: m.fullName ?? m.email, email: m.email,
       } ));
      setMembers(mapped);
      setMeId(me?.user?.id ?? null);
    }).finally(() => setLoading(false));
    return () => { ignore = true; };
}, []);

  const dirty = JSON.stringify(ooo) !== JSON.stringify(original);
  const today = new Date().toISOString().slice(0, 10);
  const inWindow =
    ooo.enabled && ooo.start_date && ooo.end_date &&
    today >= ooo.start_date && today <= ooo.end_date;

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/user/out-of-office', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ out_of_office: ooo }),
    });
    const d = await res.json();
    if (res.ok) {
      const total = ooo.auto_reassign && d.reassigned
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? Object.values(d.reassigned).reduce((a: number, b: any) => a + Number(b ?? 0), 0)
        : 0;
      toast.success(total > 0 ? `Saved. Reassigned ${total} record(s).` : 'Out-of-office saved');
      setOriginal(ooo);
    } else {
      toast.error(d.error || 'Failed to save');
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Plane className="w-5 h-5 text-violet-600" />Out of Office</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Tell NuCRM you're away. Optionally reassign your work to a teammate while you're out.
        </p>
      </div>

      {/* Status banner */}
      <div className={cn(
        'rounded-xl border p-4 flex items-start gap-3',
        inWindow
          ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20'
          : 'border-border bg-card'
      )}>
        {inWindow ? <Plane className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />}
        <div className="text-sm">
          {inWindow ? (
            <>
              <p className="font-semibold text-amber-700 dark:text-amber-300">You're currently away</p>
              <p className="text-amber-700/70 dark:text-amber-300/70">
                Active until {ooo.end_date}.
                {ooo.delegate_user_id && (
                  <> Work routes to{' '}
                    <strong>{members.find(m => m.user_id === ooo.delegate_user_id)?.full_name ?? 'your delegate'}</strong>.
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">Available</p>
              <p className="text-muted-foreground">No upcoming out-of-office.</p>
            </>
          )}
        </div>
      </div>

      {/* Toggle */}
      <Section icon={Plane} title="Enable">
        <ToggleRow
          label="Set me as out of office"
          desc="When the date window is active, your delegate receives new assignments and can be auto-handed your existing work."
          checked={ooo.enabled}
          onChange={v => setOoo(o => ({ ...o, enabled: v }))}
        />
      </Section>

      {/* Dates */}
      <Section icon={Calendar} title="Date window">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Starts</label>
            <input
              type="date"
              value={ooo.start_date ?? ''}
              onChange={e => setOoo(o => ({ ...o, start_date: e.target.value || null }))}
              disabled={!ooo.enabled}
              className={cn(inp, !ooo.enabled && 'opacity-50')}
              min={today}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Ends</label>
            <input
              type="date"
              value={ooo.end_date ?? ''}
              onChange={e => setOoo(o => ({ ...o, end_date: e.target.value || null }))}
              disabled={!ooo.enabled}
              className={cn(inp, !ooo.enabled && 'opacity-50')}
              min={ooo.start_date ?? today}
            />
          </div>
        </div>
      </Section>

      {/* Delegate */}
      <Section icon={User} title="Delegate">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Hand work to</label>
          <select
            className={inp}
            value={ooo.delegate_user_id ?? ''}
            onChange={e => setOoo(o => ({ ...o, delegate_user_id: e.target.value || null }))}
            disabled={!ooo.enabled}
          >
            <option value="">— Choose a teammate —</option>
            {members
              .filter(m => m.user_id !== meId)
              .map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name} {m.email && `(${m.email})`}
                </option>
              ))}
          </select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Assignment rules and round-robin will skip you while you're away.
          </p>
        </div>

        <ToggleRow
          label="Also reassign my open work right now"
          desc="Move every open lead, contact, deal and pending task currently assigned to you to the delegate."
          checked={ooo.auto_reassign}
          onChange={v => setOoo(o => ({ ...o, auto_reassign: v }))}
          disabled={!ooo.enabled || !ooo.delegate_user_id}
          danger
        />
        {ooo.enabled && ooo.auto_reassign && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2 text-xs">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-amber-700 dark:text-amber-300">
              Saving will move every open record assigned to you to your delegate.
              This is logged in the audit trail and can't be auto-reverted.
            </p>
          </div>
        )}
      </Section>

      {/* Auto-reply */}
      <Section icon={MessageSquare} title="Auto-reply (optional)">
        <textarea
          rows={4}
          value={ooo.auto_reply}
          onChange={e => setOoo(o => ({ ...o, auto_reply: e.target.value }))}
          className={inp}
          placeholder="I'm away from May 27 to June 3 with limited access to email. For urgent matters please contact …"
          disabled={!ooo.enabled}
          maxLength={1000}
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Up to 1,000 characters. Used by sequences and customer-facing replies that respect OOO.
        </p>
      </Section>

      {/* Save bar */}
      <div className={cn(
        'sticky bottom-0 -mx-6 px-6 py-3 border-t border-border bg-background/80 backdrop-blur flex items-center justify-end gap-2 transition-opacity',
        dirty ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}>
        <button onClick={() => setOoo(original)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Discard
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500';

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

function ToggleRow({ label, desc, checked, onChange, disabled, danger }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-1', disabled && 'opacity-50')}>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', danger && checked && 'text-amber-700 dark:text-amber-400')}>{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5',
          checked ? (danger ? 'bg-amber-600' : 'bg-violet-600') : 'bg-muted',
          disabled && 'cursor-not-allowed'
        )}
      >
        <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-5' : 'translate-x-1')} />
      </button>
    </div>
  );
}
