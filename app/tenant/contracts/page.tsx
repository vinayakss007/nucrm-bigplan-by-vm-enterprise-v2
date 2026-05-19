'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, FileText, X, Calendar, DollarSign, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Contact { id: string; firstName: string; lastName: string; email: string | null; }
interface Contract {
  id: string;
  title: string;
  contractNumber: string | null;
  contractType: string;
  status: string;
  startDate: string;
  endDate: string | null;
  totalValue: string | null;
  contactId: string | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  expired: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

export default function ContractsPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6 text-center">Loading...</div>}>
      <ContractsPageInner />
    </Suspense>
  );
}

function ContractsPageInner() {
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get('contactId') || '';
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contactFilter, setContactFilter] = useState(initialContactId);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ contactId: initialContactId, title: '', contractType: 'service', startDate: '', endDate: '', totalValue: '', terms: '', notes: '' });

  useEffect(() => { fetchContracts(); fetchContacts(); }, []);

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/tenant/contacts');
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (error) { console.error('Failed to fetch contacts', error); }
  };

  const fetchContracts = async () => {
    try {
      const res = await fetch('/api/tenant/contracts');
      const data = await res.json();
      setContracts(data.contracts || []);
    } catch (error) {
      console.error('Failed to fetch contracts', error);
    } finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/tenant/contracts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Contract created');
      setShowModal(false);
      setForm({ contactId: '', title: '', contractType: 'service', startDate: '', endDate: '', totalValue: '', terms: '', notes: '' });
      fetchContracts();
    } catch (error) { toast.error('Failed to create contract'); }
  };

  const getContactName = (contactId: string | null) => {
    if (!contactId) return '-';
    const c = contacts.find(c => c.id === contactId);
    return c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || '-' : '-';
  };

  const filtered = contracts.filter(c =>
    (c.title?.toLowerCase().includes(search.toLowerCase()) || getContactName((c as any).contactId).toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || c.status === statusFilter) &&
    (!contactFilter || c.contactId === contactFilter)
  );

  const activeValue = filtered.filter(c => c.status === 'active').reduce((sum, c) => sum + (parseFloat(c.totalValue ?? '0') || 0), 0);

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Contracts</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage contracts and agreements</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-xs sm:text-sm shrink-0">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New Contract</span><span className="sm:hidden">New</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total', value: contracts.length },
          { label: 'Active', value: contracts.filter(c => c.status === 'active').length, color: 'text-green-600' },
          { label: 'Total Value', value: `$${activeValue.toFixed(2)}`, color: 'text-violet-600' },
        ].map(s => (
          <div key={s.label} className="admin-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn('text-lg sm:text-xl font-bold', (s as any).color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search contracts..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
        </div>
        <div className="flex gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-card text-xs sm:text-sm">
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
          </select>
          <select value={contactFilter} onChange={(e) => setContactFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-card text-xs sm:text-sm max-w-[160px]">
            <option value="">All Contacts</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Cards Grid */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium">No contracts found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((contract) => (
            <div key={contract.id} className="admin-card p-4 hover:border-violet-300 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-sm truncate">{contract.title}</h3>
                  <p className="text-xs text-muted-foreground capitalize">{contract.contractType}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1"><User className="w-3 h-3 shrink-0" /> <span className="truncate">{getContactName(contract.contactId)}</span></p>
                </div>
                <span className={`px-2 py-1 text-[10px] rounded-full font-medium shrink-0 ml-2 ${statusColors[contract.status]}`}>{contract.status}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3 shrink-0" /> {new Date(contract.startDate).toLocaleDateString()}</span>
                {contract.totalValue && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3 shrink-0" /> ${parseFloat(contract.totalValue).toFixed(2)}</span>}
              </div>
              {contract.endDate && <p className="text-xs text-muted-foreground">Expires: {new Date(contract.endDate).toLocaleDateString()}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base sm:text-lg font-semibold">New Contract</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-accent rounded"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Contact</label>
                <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm">
                  <option value="">Select contact...</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.firstName} {c.lastName} {c.email ? `(${c.email})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Title *</label>
                <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm">
                    <option value="service">Service</option>
                    <option value="sales">Sales</option>
                    <option value="nda">NDA</option>
                    <option value="partnership">Partnership</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Total Value</label>
                  <input type="number" step="0.01" value={form.totalValue} onChange={(e) => setForm({ ...form, totalValue: e.target.value })}
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
                  <label className="block text-sm font-medium mb-1">End Date</label>
                  <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Terms</label>
                <textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={3}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
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
