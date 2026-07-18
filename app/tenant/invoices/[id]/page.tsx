'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit2, Trash2, Save, X, FileText, Send, CheckCircle, XCircle, Calendar, Download, Mail, DollarSign } from 'lucide-react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Invoice {
  id: string;
  title: string | null;
  invoiceNumber: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  subtotal: string | null;
  discountType: string | null;
  discountValue: string | null;
  discountAmount: string | null;
  taxRate: string | null;
  taxAmount: string | null;
  totalAmount: string;
  amountPaid: string | null;
  balanceDue: string | null;
  currency: string | null;
  notes: string | null;
  terms: string | null;
  footer: string | null;
  contactId: string | null;
  companyId: string | null;
  quoteId: string | null;
  orderId: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  sentAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  viewed: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Invoice>>({});

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        const res = await fetch(`/api/tenant/invoices/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setInvoice(data.data);
      } catch {
        toast.error('Failed to load invoice');
      } finally {
        setLoading(false);
      }
    };
    fetchInvoice();
  }, [id]);

  const handleEdit = () => {
    if (invoice) {
      setForm({
        title: invoice.title,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        subtotal: invoice.subtotal,
        discountType: invoice.discountType,
        discountValue: invoice.discountValue,
        discountAmount: invoice.discountAmount,
        taxRate: invoice.taxRate,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        amountPaid: invoice.amountPaid,
        balanceDue: invoice.balanceDue,
        notes: invoice.notes,
        terms: invoice.terms,
        footer: invoice.footer,
        paymentMethod: invoice.paymentMethod,
        paymentReference: invoice.paymentReference,
      });
      setEditing(true);
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tenant/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      setInvoice(data.data);
      setEditing(false);
      toast.success('Invoice updated');
    } catch {
      toast.error('Failed to update invoice');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/tenant/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setInvoice(data.data);
      toast.success(`Invoice marked as ${newStatus}`);
    } catch {
      toast.error('Failed to change status');
    }
  };

  const handleDelete = async () => {
    await confirmThen('Are you sure you want to delete this invoice?', async () => {
      try {
        const res = await fetch(`/api/tenant/invoices/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed');
        toast.success('Invoice deleted');
        router.push('/tenant/invoices');
      } catch {
        toast.error('Failed to delete invoice');
      }
    });
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

  if (!invoice) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-lg font-semibold">Invoice not found</p>
        <Link href="/tenant/invoices" className="text-sm text-violet-600 hover:underline mt-2 inline-block">Back to invoices</Link>
      </div>
    );
  }

  const fmt = (v: string | null | undefined) => v ? `$${parseFloat(v).toFixed(2)}` : '$0.00';

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Back button */}
      <Link href="/tenant/invoices" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Invoices
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-bold">{invoice.title || invoice.invoiceNumber}</h1>
            <span className={cn('px-2 py-1 text-xs rounded-full font-medium', statusColors[invoice.status])}>{invoice.status}</span>
          </div>
          {invoice.invoiceNumber && <p className="text-sm text-muted-foreground mt-1">#{invoice.invoiceNumber}</p>}
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
        <button
          onClick={() => window.open(`/api/tenant/invoices/${id}/pdf`, '_blank')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent transition-colors"
        >
          <Download className="w-3 h-3" /> Download PDF
        </button>
        <button
          onClick={async () => {
            const email = window.prompt('Send invoice to email address:');
            if (!email) return;
            try {
              const res = await fetch(`/api/tenant/offers/${id}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to_email: email }),
              });
              if (res.ok) {
                toast.success(`Invoice sent to ${email}`);
                setInvoice(prev => prev ? { ...prev, status: 'sent' } : prev);
              } else {
                const data = await res.json();
                toast.error(data.error || 'Failed to send');
              }
            } catch {
              toast.error('Failed to send email');
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent transition-colors"
        >
          <Mail className="w-3 h-3" /> Send via Email
        </button>
        {invoice.status === 'draft' && (
          <button onClick={() => handleStatusChange('sent')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Send className="w-3 h-3" /> Send Invoice
          </button>
        )}
        {['draft', 'sent', 'viewed', 'overdue'].includes(invoice.status) && (
          <button onClick={() => handleStatusChange('paid')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
            <CheckCircle className="w-3 h-3" /> Mark Paid
          </button>
        )}
        {['sent', 'viewed'].includes(invoice.status) && (
          <button onClick={() => handleStatusChange('overdue')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors">
            <XCircle className="w-3 h-3" /> Mark Overdue
          </button>
        )}
        {invoice.quoteId && (
          <Link href={`/tenant/quotes/${invoice.quoteId}`} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent transition-colors">
            <FileText className="w-3 h-3" /> View Quote
          </Link>
        )}
      </div>

      {/* Details */}
      {editing ? (
        <div className="admin-card p-4 sm:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input type="text" value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Issue Date</label>
              <input type="date" value={form.issueDate || ''} onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Due Date</label>
              <input type="date" value={form.dueDate || ''} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subtotal</label>
              <input type="number" step="0.01" value={form.subtotal || ''} onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Discount Amount</label>
              <input type="number" step="0.01" value={form.discountAmount || ''} onChange={(e) => setForm({ ...form, discountAmount: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tax Amount</label>
              <input type="number" step="0.01" value={form.taxAmount || ''} onChange={(e) => setForm({ ...form, taxAmount: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Total Amount</label>
              <input type="number" step="0.01" value={form.totalAmount || ''} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount Paid</label>
              <input type="number" step="0.01" value={form.amountPaid || ''} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Balance Due</label>
              <input type="number" step="0.01" value={form.balanceDue || ''} onChange={(e) => setForm({ ...form, balanceDue: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Payment Method</label>
              <input type="text" value={form.paymentMethod || ''} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Payment Reference</label>
              <input type="text" value={form.paymentReference || ''} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
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
        <>
          {/* Invoice Summary */}
          <div className="admin-card p-4 sm:p-6">
            <h2 className="text-sm font-semibold mb-3">Invoice Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Issue Date</p>
                <p className="text-sm font-medium">{new Date(invoice.issueDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Due Date</p>
                <p className="text-sm font-medium">{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '-'}</p>
              </div>
              {invoice.sentAt && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Sent At</p>
                  <p className="text-sm font-medium">{new Date(invoice.sentAt).toLocaleDateString()}</p>
                </div>
              )}
              {invoice.paidAt && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-600" /> Paid At</p>
                  <p className="text-sm font-medium text-green-600">{new Date(invoice.paidAt).toLocaleDateString()}</p>
                </div>
              )}
              {invoice.cancelledAt && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Cancelled At</p>
                  <p className="text-sm font-medium text-red-600">{new Date(invoice.cancelledAt).toLocaleDateString()}</p>
                </div>
              )}
              {invoice.paymentMethod && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><DollarSign className="w-3 h-3" /> Payment Method</p>
                  <p className="text-sm font-medium">{invoice.paymentMethod}</p>
                </div>
              )}
              {invoice.paymentReference && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Payment Reference</p>
                  <p className="text-sm font-medium">{invoice.paymentReference}</p>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="space-y-2 max-w-xs ml-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{fmt(invoice.subtotal)}</span>
                </div>
                {invoice.discountAmount && parseFloat(invoice.discountAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="text-red-600">-{fmt(invoice.discountAmount)}</span>
                  </div>
                )}
                {invoice.taxAmount && parseFloat(invoice.taxAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>{fmt(invoice.taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t border-border pt-2">
                  <span>Total</span>
                  <span className="text-violet-600">{fmt(invoice.totalAmount)}</span>
                </div>
                {invoice.amountPaid && parseFloat(invoice.amountPaid) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Paid</span>
                    <span className="text-green-600">-{fmt(invoice.amountPaid)}</span>
                  </div>
                )}
                {invoice.balanceDue && parseFloat(invoice.balanceDue) > 0 && (
                  <div className="flex justify-between text-sm font-semibold">
                    <span className="text-red-600">Balance Due</span>
                    <span className="text-red-600">{fmt(invoice.balanceDue)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contact/Company */}
          {(invoice.contactId || invoice.companyId) && (
            <div className="admin-card p-4 sm:p-6">
              <div className="flex gap-6">
                {invoice.contactId && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Contact</p>
                    <Link href={`/tenant/contacts/${invoice.contactId}`} className="text-sm text-violet-600 hover:underline">
                      View Contact
                    </Link>
                  </div>
                )}
                {invoice.companyId && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Company</p>
                    <Link href={`/tenant/companies/${invoice.companyId}`} className="text-sm text-violet-600 hover:underline">
                      View Company
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Terms */}
          {invoice.terms && (
            <div className="admin-card p-4 sm:p-6">
              <h2 className="text-sm font-semibold mb-2">Terms</h2>
              <p className="text-sm whitespace-pre-wrap">{invoice.terms}</p>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="admin-card p-4 sm:p-6">
              <h2 className="text-sm font-semibold mb-2">Notes</h2>
              <p className="text-sm whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
