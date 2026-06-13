'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, Eye, Download, FileText, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Contact { id: string; firstName: string; lastName: string; email: string | null; }
interface Invoice {
  id: string;
  invoiceNumber: string;
  title: string | null;
  status: string;
  issueDate: string;
  dueDate: string | null;
  totalAmount: string;
  balanceDue: string;
  contactId: string | null;
  contact?: { firstName: string | null; lastName: string | null };
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-indigo-100 text-indigo-700',
  partial: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700',
};

function InvoicesPageInner() {
  const searchParams = useSearchParams();
  const initialContactId = searchParams.get('contactId') || '';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [contactFilter, setContactFilter] = useState(initialContactId);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    title: '',
    contactId: initialContactId,
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    notes: '',
    items: [{ description: '', quantity: '1', unitPrice: '0' }],
    discountType: 'percentage',
    discountValue: '0',
    taxRate: '0',
  });

  useEffect(() => { fetchInvoices(); fetchContacts(); }, []);

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/tenant/contacts');
      const data = await res.json();
      setContacts(data.contacts || []);
    } catch (error) { console.error('Failed to fetch contacts', error); }
  };

  const fetchInvoices = async () => {
    try {
      const res = await fetch('/api/tenant/invoices');
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch (error) {
      console.error('Failed to fetch invoices', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/tenant/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to create invoice');
      toast.success('Invoice created successfully');
      setShowModal(false);
      setForm({ title: '', contactId: '', issueDate: new Date().toISOString().split('T')[0], dueDate: '', notes: '', items: [{ description: '', quantity: '1', unitPrice: '0' }], discountType: 'percentage', discountValue: '0', taxRate: '0' });
      fetchInvoices();
    } catch {
      toast.error('Failed to create invoice');
    }
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { description: '', quantity: '1', unitPrice: '0' } as { description: string; quantity: string; unitPrice: string }] });
  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  const updateItem = (idx: number, field: string, value: string) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value } as { description: string; quantity: string; unitPrice: string };
    setForm({ ...form, items });
  };

  const getContactName = (contactId: string | null) => {
    if (!contactId) return '-';
    const c = contacts.find(c => c.id === contactId);
    return c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.email || '-' : '-';
  };

  const filtered = invoices.filter(i =>
    (i.invoiceNumber.toLowerCase().includes(search.toLowerCase()) || getContactName((i as any).contactId).toLowerCase().includes(search.toLowerCase())) &&
    (!statusFilter || i.status === statusFilter) &&
    (!contactFilter || i.contactId === contactFilter)
  );

  const totalOutstanding = filtered.filter(i => !['paid', 'cancelled'].includes(i.status)).reduce((sum, i) => sum + parseFloat(i.balanceDue), 0);

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Invoices</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Manage invoices and payments</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-xs sm:text-sm shrink-0">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Create Invoice</span><span className="sm:hidden">New</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: invoices.length, color: '' },
          { label: 'Outstanding', value: `$${totalOutstanding.toFixed(2)}`, color: 'text-amber-600' },
          { label: 'Paid', value: invoices.filter(i => i.status === 'paid').length, color: 'text-green-600' },
          { label: 'Overdue', value: invoices.filter(i => i.status === 'overdue').length, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="admin-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={cn('text-lg sm:text-xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40" />
        </div>
        <div className="flex gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-border rounded-lg bg-card text-xs sm:text-sm">
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
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

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm font-medium">No invoices found</p>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <div className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
            <table className="w-full min-w-[700px]">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Invoice #</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Contact</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Title</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Date</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Amount</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Status</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{invoice.invoiceNumber}</td>
                    <td className="px-4 py-3 text-xs">{getContactName(invoice.contactId)}</td>
                    <td className="px-4 py-3 text-xs hidden sm:table-cell">{invoice.title || '-'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden md:table-cell">{new Date(invoice.issueDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-xs font-semibold">${parseFloat(invoice.totalAmount).toFixed(2)}</td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`px-2 py-1 text-[10px] rounded-full font-medium ${statusColors[invoice.status] || 'bg-slate-100'}`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button className="p-1.5 hover:bg-accent rounded transition-colors"><Eye className="w-3.5 h-3.5" /></button>
                        <button className="p-1.5 hover:bg-accent rounded transition-colors"><Download className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base sm:text-lg font-semibold">Create Invoice</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-accent rounded"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Title</label>
                  <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Issue Date *</label>
                  <input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} required
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
              </div>
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
                <label className="block text-sm font-medium mb-1">Due Date</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Line Items</label>
                {form.items.map((item, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row gap-2 mb-2">
                    <input type="text" placeholder="Description" value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      className="flex-1 px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                    <div className="flex gap-2">
                      <input type="number" placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        className="w-20 px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                      <input type="number" placeholder="Price" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                        className="w-24 px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                      <button type="button" onClick={() => removeItem(idx)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addItem} className="text-sm text-violet-600 hover:underline">+ Add Item</button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Discount Type</label>
                  <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm">
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Discount Value</label>
                  <input type="number" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tax Rate (%)</label>
                  <input type="number" value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700">Create Invoice</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Loading...</div>}>
      <InvoicesPageInner />
    </Suspense>
  );
}