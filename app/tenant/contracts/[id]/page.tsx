'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit2, Trash2, Save, X, Calendar, DollarSign, FileText, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Contract {
  id: string;
  title: string;
  contractNumber: string | null;
  contractType: string;
  status: string;
  startDate: string;
  endDate: string | null;
  totalValue: string | null;
  billingFrequency: string | null;
  terms: string | null;
  notes: string | null;
  contactId: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

const allStatuses = ['draft', 'pending', 'active', 'expired', 'cancelled'];

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Contract>>({});

  useEffect(() => {
    const fetchContract = async () => {
      try {
        const res = await fetch(`/api/tenant/contracts/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setContract(data.data);
      } catch {
        toast.error('Failed to load contract');
      } finally {
        setLoading(false);
      }
    };
    fetchContract();
  }, [id]);

  const handleEdit = () => {
    if (contract) {
      setForm({
        title: contract.title,
        contractType: contract.contractType,
        startDate: contract.startDate,
        endDate: contract.endDate,
        totalValue: contract.totalValue,
        billingFrequency: contract.billingFrequency,
        terms: contract.terms,
        notes: contract.notes,
      });
      setEditing(true);
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tenant/contracts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      setContract(data.data);
      setEditing(false);
      toast.success('Contract updated');
    } catch {
      toast.error('Failed to update contract');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/tenant/contracts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setContract(data.data);
      toast.success(`Status changed to ${newStatus}`);
    } catch {
      toast.error('Failed to change status');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this contract?')) return;
    try {
      const res = await fetch(`/api/tenant/contracts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Contract deleted');
      router.push('/tenant/contracts');
    } catch {
      toast.error('Failed to delete contract');
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

  if (!contract) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-lg font-semibold">Contract not found</p>
        <Link href="/tenant/contracts" className="text-sm text-violet-600 hover:underline mt-2 inline-block">Back to contracts</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Back button */}
      <Link href="/tenant/contracts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Contracts
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-bold">{contract.title}</h1>
            <span className={cn('px-2 py-1 text-xs rounded-full font-medium', statusColors[contract.status])}>{contract.status}</span>
          </div>
          {contract.contractNumber && <p className="text-sm text-muted-foreground mt-1">#{contract.contractNumber}</p>}
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

      {/* Status Change */}
      <div className="flex flex-wrap gap-2">
        {allStatuses.filter(s => s !== contract.status).map(s => (
          <button key={s} onClick={() => handleStatusChange(s)} className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent capitalize transition-colors">
            Mark as {s}
          </button>
        ))}
      </div>

      {/* Details Grid */}
      {editing ? (
        <div className="admin-card p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input type="text" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select value={form.contractType || ''} onChange={(e) => setForm({ ...form, contractType: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm">
                <option value="service">Service</option>
                <option value="sales">Sales</option>
                <option value="nda">NDA</option>
                <option value="partnership">Partnership</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <input type="date" value={form.startDate || ''} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <input type="date" value={form.endDate || ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Total Value</label>
              <input type="number" step="0.01" value={form.totalValue || ''} onChange={(e) => setForm({ ...form, totalValue: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Billing Frequency</label>
              <select value={form.billingFrequency || ''} onChange={(e) => setForm({ ...form, billingFrequency: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm">
                <option value="">None</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Terms</label>
            <textarea value={form.terms || ''} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={4}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
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
              <p className="text-xs text-muted-foreground mb-1">Contract Type</p>
              <p className="text-sm font-medium capitalize">{contract.contractType}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Start Date</p>
              <p className="text-sm font-medium">{new Date(contract.startDate).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> End Date</p>
              <p className="text-sm font-medium">{contract.endDate ? new Date(contract.endDate).toLocaleDateString() : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Total Value</p>
              <p className="text-sm font-medium">{contract.totalValue ? `$${parseFloat(contract.totalValue).toFixed(2)}` : '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Billing Frequency</p>
              <p className="text-sm font-medium capitalize">{contract.billingFrequency || '-'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Created</p>
              <p className="text-sm font-medium">{new Date(contract.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          {contract.contactId && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><User className="w-3 h-3" /> Contact</p>
              <Link href={`/tenant/contacts/${contract.contactId}`} className="text-sm text-violet-600 hover:underline">
                View Contact
              </Link>
            </div>
          )}

          {contract.terms && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">Terms</p>
              <p className="text-sm whitespace-pre-wrap">{contract.terms}</p>
            </div>
          )}

          {contract.notes && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">Notes</p>
              <p className="text-sm whitespace-pre-wrap">{contract.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
