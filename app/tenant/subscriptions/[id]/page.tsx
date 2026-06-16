'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit2, Trash2, Save, X, Calendar, DollarSign, CreditCard, RefreshCw, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Subscription {
  id: string;
  name: string;
  planName: string | null;
  status: string;
  startDate: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  amount: string;
  currency: string | null;
  billingFrequency: string;
  autoRenew: boolean;
  paymentMethod: string | null;
  last4: string | null;
  contactId: string | null;
  companyId: string | null;
  cancelledAt: string | null;
  trialEndDate: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  trialing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  past_due: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
};

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Subscription>>({});

  const fetchSubscription = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant/subscriptions/${id}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setSubscription(data.data);
    } catch {
      toast.error('Failed to load subscription');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchSubscription(); }, [id, fetchSubscription]);

  const handleEdit = () => {
    if (subscription) {
      setForm({
        name: subscription.name,
        planName: subscription.planName,
        amount: subscription.amount,
        billingFrequency: subscription.billingFrequency,
        autoRenew: subscription.autoRenew,
        currentPeriodEnd: subscription.currentPeriodEnd,
      });
      setEditing(true);
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tenant/subscriptions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      setSubscription(data.data);
      setEditing(false);
      toast.success('Subscription updated');
    } catch {
      toast.error('Failed to update subscription');
    }
  };

  const handleStatusAction = async (action: 'pause' | 'resume' | 'cancel') => {
    const statusMap = { pause: 'paused', resume: 'active', cancel: 'cancelled' };
    const newStatus = statusMap[action];
    if (action === 'cancel' && !confirm('Are you sure you want to cancel this subscription?')) return;
    try {
      const body: Record<string, unknown> = { status: newStatus };
      if (action === 'cancel') body['cancelledAt'] = new Date().toISOString();
      const res = await fetch(`/api/tenant/subscriptions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setSubscription(data.data);
      toast.success(`Subscription ${action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'resumed'}`);
    } catch {
      toast.error(`Failed to ${action} subscription`);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this subscription?')) return;
    try {
      const res = await fetch(`/api/tenant/subscriptions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Subscription deleted');
      router.push('/tenant/subscriptions');
    } catch {
      toast.error('Failed to delete subscription');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded" />
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="admin-card p-6 space-y-4">
          {[...Array(5)].map((_, i) => <div key={i} className="h-4 w-full bg-muted rounded" />)}
        </div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="text-center py-12">
        <CreditCard className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-lg font-semibold">Subscription not found</p>
        <Link href="/tenant/subscriptions" className="text-sm text-violet-600 hover:underline mt-2 inline-block">Back to subscriptions</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Back button */}
      <Link href="/tenant/subscriptions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Subscriptions
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-bold">{subscription.name}</h1>
            <span className={cn('px-2 py-1 text-xs rounded-full font-medium', statusColors[subscription.status])}>{subscription.status}</span>
          </div>
          {subscription.planName && <p className="text-sm text-muted-foreground mt-1">{subscription.planName}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleEdit} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-accent transition-colors">
            <Edit2 className="w-3.5 h-3.5" /> Edit
          </button>
          <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {subscription.status === 'active' && (
          <button onClick={() => handleStatusAction('pause')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent transition-colors">
            <Pause className="w-3 h-3" /> Pause
          </button>
        )}
        {subscription.status === 'paused' && (
          <button onClick={() => handleStatusAction('resume')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent transition-colors">
            <Play className="w-3 h-3" /> Resume
          </button>
        )}
        {subscription.status !== 'cancelled' && (
          <button onClick={() => handleStatusAction('cancel')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors">
            <X className="w-3 h-3" /> Cancel Subscription
          </button>
        )}
      </div>

      {/* Details */}
      {editing ? (
        <div className="admin-card p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input type="text" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Plan Name</label>
              <input type="text" value={form.planName || ''} onChange={(e) => setForm({ ...form, planName: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <input type="number" step="0.01" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Billing Frequency</label>
              <select value={form.billingFrequency || ''} onChange={(e) => setForm({ ...form, billingFrequency: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Period End</label>
              <input type="date" value={form.currentPeriodEnd || ''} onChange={(e) => setForm({ ...form, currentPeriodEnd: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" checked={form.autoRenew ?? false} onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })} className="w-4 h-4" />
              <label className="text-sm">Auto-renew</label>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-4 py-2 border border-border rounded-lg text-sm hover:bg-accent">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700">
              <Save className="w-3.5 h-3.5" /> Save Changes
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-card p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Amount</p>
              <p className="text-xl font-bold text-violet-600">${parseFloat(subscription.amount).toFixed(2)}<span className="text-xs text-muted-foreground font-normal">/{subscription.billingFrequency}</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Start Date</p>
              <p className="text-sm font-medium">{new Date(subscription.startDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Period End</p>
              <p className="text-sm font-medium">{subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Currency</p>
              <p className="text-sm font-medium">{subscription.currency || 'USD'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Auto-renew</p>
              <p className="text-sm font-medium">{subscription.autoRenew ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Created</p>
              <p className="text-sm font-medium">{new Date(subscription.createdAt).toLocaleDateString()}</p>
            </div>
            {subscription.trialEndDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Trial Ends</p>
                <p className="text-sm font-medium">{new Date(subscription.trialEndDate).toLocaleDateString()}</p>
              </div>
            )}
            {subscription.cancelledAt && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Cancelled At</p>
                <p className="text-sm font-medium text-red-600">{new Date(subscription.cancelledAt).toLocaleDateString()}</p>
              </div>
            )}
          </div>

          {subscription.contactId && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">Contact</p>
              <Link href={`/tenant/contacts/${subscription.contactId}`} className="text-sm text-violet-600 hover:underline">
                View Contact
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
