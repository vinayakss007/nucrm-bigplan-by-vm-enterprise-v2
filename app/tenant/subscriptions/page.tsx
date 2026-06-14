'use client';
import { useState, useEffect } from 'react';
import { Plus, Search, RefreshCw, X, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Subscription {
  id: string;
  name: string;
  planName: string | null;
  status: string;
  startDate: string;
  currentPeriodEnd: string | null;
  amount: string;
  billingFrequency: string;
  autoRenew: boolean;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  trialing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  past_due: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    name: '', planName: '', startDate: new Date().toISOString().split('T')[0],
    currentPeriodEnd: '', amount: '', billingFrequency: 'monthly',
    autoRenew: true, paymentMethod: '', last4: '',
  });

  useEffect(() => { fetchSubscriptions(); }, []);

  const fetchSubscriptions = async () => {
    try {
      const res = await fetch('/api/tenant/subscriptions');
      const data = await res.json();
      setSubscriptions(data.subscriptions || []);
    } catch (error) { console.error('Failed to fetch subscriptions', error); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/tenant/subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Subscription created');
      setShowModal(false);
      setForm({ name: '', planName: '', startDate: new Date().toISOString().split('T')[0], currentPeriodEnd: '', amount: '', billingFrequency: 'monthly', autoRenew: true, paymentMethod: '', last4: '' });
      fetchSubscriptions();
    } catch { toast.error('Failed to create subscription'); }
  };

  const filtered = subscriptions.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  const mrr = subscriptions.filter(s => s.status === 'active' && s.billingFrequency === 'monthly').reduce((sum, s) => sum + parseFloat(s.amount), 0);
  const arr = subscriptions.filter(s => s.status === 'active' && s.billingFrequency === 'yearly').reduce((sum, s) => sum + parseFloat(s.amount), 0) * 12 + mrr * 12;

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Subscriptions</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage recurring subscriptions</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-xs sm:text-sm shrink-0">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Subscription</span><span className="sm:hidden">New</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: subscriptions.length },
          { label: 'Active', value: subscriptions.filter(s => s.status === 'active').length, color: 'text-green-600' },
          { label: 'MRR', value: `$${mrr.toFixed(2)}`, color: 'text-violet-600' },
          { label: 'ARR', value: `$${arr.toFixed(2)}`, color: 'text-indigo-600' },
        ].map(s => (
          <div key={s.label} className="admin-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
            <p className={cn('text-lg sm:text-xl font-bold', (s as any).color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="text" placeholder="Search subscriptions..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
      </div>

      {/* Cards Grid */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium">No subscriptions found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((sub) => (
            <div key={sub.id} className="admin-card p-4 hover:border-violet-300 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm truncate">{sub.name}</h3>
                  <p className="text-xs text-muted-foreground">{sub.planName || sub.billingFrequency}</p>
                </div>
                <span className={`px-2 py-1 text-[10px] rounded-full font-medium shrink-0 ml-2 ${statusColors[sub.status]}`}>{sub.status}</span>
              </div>
              <p className="text-xl font-bold text-violet-600 mb-3">${parseFloat(sub.amount).toFixed(2)}<span className="text-xs text-muted-foreground font-normal">/{sub.billingFrequency}</span></p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3 shrink-0" /> {new Date(sub.startDate).toLocaleDateString()}</span>
                {sub.autoRenew && <span className="flex items-center gap-1 text-green-600"><RefreshCw className="w-3 h-3 shrink-0" /> Auto-renew</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base sm:text-lg font-semibold">New Subscription</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-accent rounded"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Plan Name</label>
                  <input type="text" value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date *</label>
                  <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Period End</label>
                  <input type="date" value={form.currentPeriodEnd} onChange={(e) => setForm({ ...form, currentPeriodEnd: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Amount *</label>
                  <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Frequency *</label>
                  <select value={form.billingFrequency} onChange={(e) => setForm({ ...form, billingFrequency: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm">
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.autoRenew} onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })}
                  className="w-4 h-4" />
                <label className="text-sm">Auto-renew enabled</label>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
