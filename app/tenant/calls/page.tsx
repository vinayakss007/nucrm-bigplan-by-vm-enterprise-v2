'use client';
import { useState, useEffect, useMemo } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Clock, X, Pencil, Trash2, Search } from 'lucide-react';
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
  const [editingCall, setEditingCall] = useState<CallLog | null>(null);
  const [contacts, setContacts] = useState<{ id: string; firstName?: string; first_name?: string; lastName?: string; last_name?: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'inbound' | 'outbound'>('all');

  const filteredCalls = useMemo(() => {
    let result = calls;
    if (directionFilter !== 'all') {
      result = result.filter(c => c.direction === directionFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(c => {
        const contactName = `${c.firstName || ''} ${c.lastName || ''}`.trim().toLowerCase();
        const phone = (c.phoneNumber || '').toLowerCase();
        const notes = (c.notes || '').toLowerCase();
        return contactName.includes(q) || phone.includes(q) || notes.includes(q);
      });
    }
    return result;
  }, [calls, searchQuery, directionFilter]);

  useEffect(() => {
    fetchCalls();
    fetch('/api/tenant/contacts?limit=200').then(r => r.json()).catch(() => ({ data: [] })).then(res => {
      setContacts(res.data || []);
    });
  }, []);

  function fetchCalls() {
    setLoading(true);
    fetch('/api/tenant/calls?limit=100')
      .then(r => r.json())
      .catch(() => ({ data: [] }))
      .then(res => {
        setCalls(res.data || []);
        setLoading(false);
      });
  }

  const onCallLogged = (call: CallLog) => {
    setCalls(prev => [call, ...prev]);
    setShowForm(false);
  };

  const onCallUpdated = (updated: CallLog) => {
    setCalls(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
    setEditingCall(null);
  };

  async function handleDelete(id: string) {
    if (!confirm('Delete this call log?')) return;
    try {
      const res = await fetch(`/api/tenant/calls/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Call deleted');
      setCalls(prev => prev.filter(c => c.id !== id));
    } catch {
      toast.error('Failed to delete call');
    }
  }

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

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by contact name, phone number, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        <select
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value as 'all' | 'inbound' | 'outbound')}
          className="px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="all">All Directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
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
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Actions</th>
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
                  <td className="px-4 py-3"><div className="w-16 h-4 rounded bg-muted animate-pulse" /></td>
                </tr>
              ))
            ) : filteredCalls.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">{calls.length === 0 ? 'No calls logged yet' : 'No calls match your search'}</p>
                </td>
              </tr>
            ) : (
              filteredCalls.map(call => (
                <tr key={call.id} className="border-b border-border hover:bg-accent/50 transition-colors cursor-pointer group">
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
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingCall(call)}
                        className="p-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/20 text-violet-600 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(call.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && <LogCallModal contacts={contacts} onSaved={onCallLogged} onClose={() => setShowForm(false)} />}
      {editingCall && <EditCallModal call={editingCall} onSaved={onCallUpdated} onClose={() => setEditingCall(null)} />}
    </div>
  );
}

function EditCallModal({ call, onSaved, onClose }: { call: CallLog; onSaved: (c: CallLog) => void; onClose: () => void }) {
  const [form, setForm] = useState({
    direction: call.direction,
    duration: call.duration || 0,
    notes: call.notes || '',
    phone_number: call.phoneNumber || '',
  });
  const [saving, setSaving] = useState(false);
  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/calls/${call.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: form.direction,
          duration: form.duration,
          notes: form.notes || null,
          phone_number: form.phone_number || null,
        }),
      });
      if (res.ok) {
        const { data } = await res.json();
        toast.success('Call updated');
        onSaved(data);
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to update call');
      }
    } catch {
      toast.error('Failed to update call');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">Edit Call</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={save} className="p-5 space-y-4">
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
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LogCallModal({ contacts, onSaved, onClose }: { contacts: { id: string; firstName?: string; first_name?: string; lastName?: string; last_name?: string }[]; onSaved: (c: CallLog) => void; onClose: () => void }) {
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
              {contacts.map(c => <option key={c.id} value={c.id}>{c.firstName || c.first_name} {c.lastName || c.last_name}</option>)}
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
