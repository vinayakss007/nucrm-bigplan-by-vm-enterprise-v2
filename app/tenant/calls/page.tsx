'use client';
import { useState, useEffect } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Clock, X } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface CallLog {
  id: string;
  direction: string;
  duration: number;
  notes: string | null;
  phoneNumber: string | null;
  createdAt: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [contacts, setContacts] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/tenant/calls?limit=100').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/tenant/contacts?limit=200').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([callsRes, contactsRes]) => {
      setCalls(callsRes.data || []);
      setContacts(contactsRes.data || []);
      setLoading(false);
    });
  }, []);

  const onCallLogged = (call: CallLog) => {
    setCalls(prev => [call, ...prev]);
    setShowForm(false);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><Phone className="w-5 h-5" />Call Logs</h1>
          <p className="text-sm text-muted-foreground">Track inbound and outbound calls</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" />Log Call
        </button>
      </div>

      <div className="admin-card overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Direction</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Contact</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Notes</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-4 py-3"><div className="w-6 h-6 rounded bg-muted animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="w-24 h-4 rounded bg-muted animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="w-12 h-4 rounded bg-muted animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="w-32 h-4 rounded bg-muted animate-pulse" /></td>
                  <td className="px-4 py-3"><div className="w-20 h-4 rounded bg-muted animate-pulse" /></td>
                </tr>
              ))
            ) : calls.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No calls logged yet</p>
                </td>
              </tr>
            ) : (
              calls.map(call => (
                <tr key={call.id} className="border-b border-border hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3">
                    {call.direction === 'inbound' ? (
                      <PhoneIncoming className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <PhoneOutgoing className="w-4 h-4 text-blue-500" />
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {call.firstName || call.lastName
                      ? `${call.firstName || ''} ${call.lastName || ''}`.trim()
                      : 'Unknown'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {formatDuration(call.duration || 0)}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate text-muted-foreground">
                    {call.notes || '-'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {formatDate(call.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && <LogCallModal contacts={contacts} onSaved={onCallLogged} onClose={() => setShowForm(false)} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LogCallModal({ contacts, onSaved, onClose }: { contacts: any[]; onSaved: (c: any) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    contact_id: '',
    direction: 'outbound',
    duration: 0,
    notes: '',
    phone_number: '',
  });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.contact_id) { toast.error('Contact is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const { data } = await res.json();
        toast.success('Call logged');
        onSaved(data);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to log call');
      }
    } catch { toast.error('Failed to log call'); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">Log Call</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Contact *</label>
            <select required value={form.contact_id} onChange={e => setForm(p => ({ ...p, contact_id: e.target.value }))} className={inp}>
              <option value="">Select contact</option>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
              {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.firstName || c.first_name} {c.lastName || c.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Direction</label>
            <div className="flex gap-3">
              {['outbound', 'inbound'].map(d => (
                <label key={d} className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm capitalize transition-colors',
                  form.direction === d ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20' : 'border-border')}>
                  <input type="radio" name="direction" value={d} checked={form.direction === d} onChange={() => setForm(p => ({ ...p, direction: d }))} className="hidden" />
                  {d === 'inbound' ? <PhoneIncoming className="w-3.5 h-3.5" /> : <PhoneOutgoing className="w-3.5 h-3.5" />}
                  {d}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Duration (seconds)</label>
            <input type="number" min="0" value={form.duration} onChange={e => setForm(p => ({ ...p, duration: parseInt(e.target.value) || 0 }))} className={inp} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Phone Number</label>
            <input value={form.phone_number} onChange={e => setForm(p => ({ ...p, phone_number: e.target.value }))} className={inp} placeholder="+1 555-0123" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inp} rows={3} placeholder="Call summary..." />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Log Call'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
