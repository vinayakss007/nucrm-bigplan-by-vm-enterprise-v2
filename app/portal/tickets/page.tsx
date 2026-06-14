'use client';
import { useState, useEffect } from 'react';
import { LifeBuoy, Plus } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function PortalTicketsPage() {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetch('/api/public/tickets').then(r => r.json()).then(d => {
      setTickets(d.data || []); setLoading(false);
    }).catch((err) => { console.error('[portal/tickets] fetch failed', err); setLoading(false); });
  }, []);

  const statusColor: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30',
    in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30',
    resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30',
    closed: 'bg-slate-100 text-slate-700 dark:bg-slate-800',
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2"><LifeBuoy className="w-5 h-5" />My Tickets</h1>
          <p className="text-sm text-muted-foreground">View and manage your support requests</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition-colors">
          <Plus className="w-3.5 h-3.5" />New Ticket
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />)}
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12">
          <LifeBuoy className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No tickets yet. Create one to get help.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => (
            <div key={ticket.id} className="bg-card border border-border rounded-xl p-4 hover:border-violet-200 dark:hover:border-violet-800 transition-all">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', statusColor[ticket.status])}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-muted-foreground">{ticket.category}</span>
                  </div>
                  <h3 className="font-semibold">{ticket.subject}</h3>
                  {ticket.body && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ticket.body}</p>}
                  <p className="text-xs text-muted-foreground mt-2">{formatDate(ticket.created_at)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateTicketModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); /* reload */ }} />}
    </div>
  );
}

function CreateTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ subject: '', body: '', priority: 'medium', category: 'other', email: '' });
  const [saving, setSaving] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.subject.trim()) { toast.error('Subject is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/public/tickets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) { toast.success('Ticket created'); onCreated(); window.location.reload(); }
      else { const d = await res.json(); toast.error(d.error || 'Failed'); }
    } catch { toast.error('Failed'); }
    setSaving(false);
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">New Ticket</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-accent flex items-center justify-center text-muted-foreground">✕</button>
        </div>
        <form onSubmit={create} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Email *</label>
            <input required type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={inp} placeholder="your@email.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Subject *</label>
            <input required value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} className={inp} placeholder="How can we help?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp}>
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
                <option value="billing">Billing</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <textarea rows={4} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} className={inp} />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">
              {saving ? 'Sending...' : 'Submit Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
