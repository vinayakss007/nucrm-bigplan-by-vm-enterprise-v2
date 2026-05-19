'use client';
import { useState, useEffect } from 'react';
import { 
  LifeBuoy, Plus, Search, Filter, 
  Clock, CheckCircle2, AlertCircle, 
  User, MessageSquare, ChevronRight,
  MoreVertical, Inbox, X
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Ticket {
  id: string;
  subject: string;
  body: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  assigned_name: string | null;
}

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const loadTickets = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/tenant/tickets');
      const d = await res.json();
      if (res.ok) setTickets(d.data || []);
      else if (res.status === 403) {
        // Module not active
        setTickets([]);
      }
    } catch (err) {
      toast.error('Failed to load tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTickets(); }, []);

  const filtered = tickets.filter(t => {
    const matchesFilter = filter === 'all' || t.status === filter;
    const matchesSearch = t.subject.toLowerCase().includes(search.toLowerCase()) || 
                         (t.first_name + ' ' + t.last_name).toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'in_progress': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      case 'resolved': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
    }
  };

  const getPriorityColor = (prio: string) => {
    switch (prio) {
      case 'urgent': return 'text-red-600 font-bold';
      case 'high': return 'text-orange-600';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LifeBuoy className="w-6 h-6 text-violet-600" />
            Helpdesk
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage customer support requests and issues.</p>
        </div>
        <button 
          onClick={() => setShowCreate(true)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold transition-all shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Ticket
        </button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Open', value: tickets.filter(t => t.status === 'open').length, icon: Inbox, color: 'text-blue-600' },
          { label: 'In Progress', value: tickets.filter(t => t.status === 'in_progress').length, icon: Clock, color: 'text-amber-600' },
          { label: 'Resolved', value: tickets.filter(t => t.status === 'resolved').length, icon: CheckCircle2, color: 'text-emerald-600' },
          { label: 'Urgent', value: tickets.filter(t => t.priority === 'urgent').length, icon: AlertCircle, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border p-4 rounded-2xl shadow-sm">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg bg-muted/50", s.color)}>
                <s.icon className={cn("w-5 h-5", s.color)} />
              </div>
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search tickets by subject or customer..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {['all', 'open', 'in_progress', 'resolved'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-2.5 rounded-xl text-sm font-medium border transition-all capitalize",
                filter === f 
                  ? "bg-violet-600 border-violet-600 text-white" 
                  : "bg-card border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Tickets List */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">Loading tickets...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <LifeBuoy className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-bold">No tickets found</h3>
            <p className="text-muted-foreground max-w-xs mx-auto mt-1">
              {search || filter !== 'all' 
                ? "Try adjusting your filters or search terms." 
                : "When customers have issues, they'll appear here as support tickets."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(ticket => (
              <div key={ticket.id} onClick={() => router.push(`/tenant/tickets/${ticket.id}`)} className="p-4 hover:bg-accent/50 transition-colors group cursor-pointer">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full", getStatusColor(ticket.status))}>
                        {ticket.status.replace('_', ' ')}
                      </span>
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider", getPriorityColor(ticket.priority))}>
                        {ticket.priority}
                      </span>
                      <span className="text-xs text-muted-foreground">• {ticket.category}</span>
                    </div>
                    <h3 className="font-semibold text-sm truncate group-hover:text-violet-600 transition-colors">
                      {ticket.subject}
                    </h3>
                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <User className="w-3 h-3" />
                        {ticket.first_name ? `${ticket.first_name} ${ticket.last_name || ''}` : 'System'}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MessageSquare className="w-3 h-3" />
                        {ticket.assigned_name ? `Assigned: ${ticket.assigned_name}` : 'Unassigned'}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatDate(ticket.created_at)}
                      </div>
                    </div>
                  </div>
                  <button className="p-2 rounded-lg hover:bg-muted text-muted-foreground max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Module Upsell (if applicable) */}
      {!loading && tickets.length === 0 && filter === 'all' && !search && (
        <div className="bg-violet-50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/50 p-6 rounded-2xl flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-white dark:bg-violet-900 rounded-xl shadow-sm flex items-center justify-center mb-4">
            <CheckCircle2 className="w-6 h-6 text-violet-600" />
          </div>
          <h3 className="font-bold text-violet-900 dark:text-violet-400">Want to automate support?</h3>
          <p className="text-sm text-violet-800/70 dark:text-violet-400/70 max-w-sm mt-1">
            Connect your WhatsApp or add a support widget to your site to create tickets automatically.
          </p>
          <Link href="/tenant/modules" className="mt-4 text-sm font-bold text-violet-600 hover:underline">
            View Modules →
          </Link>
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreate && <TicketCreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadTickets(); }} />}
    </div>
  );
}

function TicketCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ subject: '', body: '', priority: 'medium', category: 'other' });
  const [saving, setSaving] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.subject.trim()) { toast.error('Subject is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) { toast.success('Ticket created'); onCreated(); }
      else { const d = await res.json(); toast.error(d.error || 'Failed'); }
    } catch { toast.error('Failed to create ticket'); }
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
            <label className="block text-xs font-medium text-muted-foreground mb-1">Subject *</label>
            <input required value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} className={inp} placeholder="Brief description of the issue" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className={inp}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} className={inp}>
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
                <option value="billing">Billing</option>
                <option value="account">Account</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <textarea rows={4} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} className={inp} placeholder="Describe the issue in detail..." />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
              {saving ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
