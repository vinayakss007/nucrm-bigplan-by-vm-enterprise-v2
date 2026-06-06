'use client';
import { useState } from 'react';
import { PhoneCall, PhoneIncoming, Clock, User, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
import toast from 'react-hot-toast';

interface CallLog {
  id: string;
  contactId: string;
  direction: string;
  duration: number;
  notes: string | null;
  phoneNumber: string | null;
  createdAt: string;
  userName: string | null;
}

export function CallLogger({ contactId, companyId, teamMembers, onLogged }: {
  contactId: string;
  companyId?: string;
  teamMembers?: { user_id: string; full_name: string }[];
  onLogged?: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    direction: 'outbound',
    duration: '',
    notes: '',
    phone_number: '',
    assigned_to: '',
  });
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.notes.trim() && !form.duration) {
      toast.error('Add notes or duration');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          company_id: companyId || undefined,
          direction: form.direction,
          duration: form.duration ? parseInt(form.duration) : 0,
          notes: form.notes.trim() || null,
          phone_number: form.phone_number || null,
          assigned_to: form.assigned_to || null,
        }),
      });
      if (res.ok) {
        toast.success('Call logged');
        setForm({ direction: 'outbound', duration: '', notes: '', phone_number: '', assigned_to: '' });
        setShowForm(false);
        onLogged?.();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to log call');
      }
    } catch {
      toast.error('Failed to log call');
    }
    setSaving(false);
  };

  return (
    <div>
      <button
        onClick={() => setShowForm(o => !o)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-violet-600 transition-colors py-1"
      >
        <PhoneCall className="w-3.5 h-3.5" />
        Log Call
      </button>

      {showForm && (
        <form onSubmit={save} className="mt-2 p-3 rounded-xl border border-border bg-card space-y-2.5 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setForm(f => ({ ...f, direction: 'outbound' }))}
              className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors',
                form.direction === 'outbound' ? 'bg-violet-600 text-white' : 'border border-border hover:bg-accent')}>
              <PhoneCall className="w-3 h-3" /> Outbound
            </button>
            <button type="button" onClick={() => setForm(f => ({ ...f, direction: 'inbound' }))}
              className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors',
                form.direction === 'inbound' ? 'bg-violet-600 text-white' : 'border border-border hover:bg-accent')}>
              <PhoneIncoming className="w-3 h-3" /> Inbound
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input type="number" placeholder="Duration (sec)" value={form.duration}
                onChange={e => setForm(f => ({ ...f, duration: e.target.value }))}
                className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-transparent" />
            </div>
            <div className="flex items-center gap-1.5">
              <PhoneCall className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input placeholder="Phone number" value={form.phone_number}
                onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-transparent" />
            </div>
          </div>
          <div className="flex items-start gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-2" />
            <textarea placeholder="Call notes..." value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-transparent resize-none" />
          </div>
          {teamMembers && teamMembers.length > 0 && (
            <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
              className="w-full px-2 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 bg-transparent">
              <option value="">Assign follow-up to...</option>
              {teamMembers.map((m: any) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex-1 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Log Call'}
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="px-3 py-1.5 rounded-lg border border-border hover:bg-accent text-xs transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function CallLogList({ calls }: { calls: CallLog[] }) {
  if (!calls.length) return null;
  return (
    <div className="space-y-1">
      {calls.map(call => (
        <div key={call.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-accent/30 transition-colors">
          <div className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0',
            call.direction === 'inbound' ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-violet-100 dark:bg-violet-900/30 text-violet-600')}>
            {call.direction === 'inbound' ? <PhoneIncoming className="w-3.5 h-3.5" /> : <PhoneCall className="w-3.5 h-3.5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium capitalize">{call.direction}</span>
              {call.duration > 0 && <span className="text-[10px] text-muted-foreground">{formatDuration(call.duration)}</span>}
              {call.userName && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <User className="w-2.5 h-2.5" />{call.userName}
                </span>
              )}
            </div>
            {call.notes && <p className="text-xs text-muted-foreground truncate mt-0.5">{call.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
