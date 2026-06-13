'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit2, Trash2, Save, X, FileText, Send, CheckCircle, XCircle, Calendar, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Quote {
  id: string;
  title: string;
  quoteNumber: string | null;
  status: string;
  subtotal: string | null;
  discount: string | null;
  tax: string | null;
  totalAmount: string;
  expiresAt: string | null;
  notes: string | null;
  terms: string | null;
  contactId: string | null;
  dealId: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  viewed: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  accepted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Quote>>({});

  const fetchQuote = async () => {
    try {
      const res = await fetch(`/api/tenant/quotes/${id}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setQuote(data.data);
    } catch {
      toast.error('Failed to load quote');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchQuote(); }, [id, fetchQuote]);

  const handleEdit = () => {
    if (quote) {
      setForm({
        title: quote.title,
        subtotal: quote.subtotal,
        discount: quote.discount,
        tax: quote.tax,
        totalAmount: quote.totalAmount,
        expiresAt: quote.expiresAt,
        notes: quote.notes,
        terms: quote.terms,
      });
      setEditing(true);
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tenant/quotes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      setQuote(data.data);
      setEditing(false);
      toast.success('Quote updated');
    } catch {
      toast.error('Failed to update quote');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/tenant/quotes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setQuote(data.data);
      toast.success(`Quote marked as ${newStatus}`);
    } catch {
      toast.error('Failed to change status');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this quote?')) return;
    try {
      const res = await fetch(`/api/tenant/quotes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Quote deleted');
      router.push('/tenant/quotes');
    } catch {
      toast.error('Failed to delete quote');
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

  if (!quote) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-lg font-semibold">Quote not found</p>
        <Link href="/tenant/quotes" className="text-sm text-violet-600 hover:underline mt-2 inline-block">Back to quotes</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Back button */}
      <Link href="/tenant/quotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Quotes
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-bold">{quote.title}</h1>
            <span className={cn('px-2 py-1 text-xs rounded-full font-medium', statusColors[quote.status])}>{quote.status}</span>
          </div>
          {quote.quoteNumber && <p className="text-sm text-muted-foreground mt-1">#{quote.quoteNumber}</p>}
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
        {quote.status === 'draft' && (
          <button onClick={() => handleStatusChange('sent')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Send className="w-3 h-3" /> Send Quote
          </button>
        )}
        {['draft', 'sent', 'viewed'].includes(quote.status) && (
          <>
            <button onClick={() => handleStatusChange('accepted')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              <CheckCircle className="w-3 h-3" /> Accept
            </button>
            <button onClick={() => handleStatusChange('declined')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors">
              <XCircle className="w-3 h-3" /> Decline
            </button>
          </>
        )}
        {quote.status === 'accepted' && (
          <Link href={`/tenant/orders?fromQuote=${quote.id}`} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors">
            <ShoppingCart className="w-3 h-3" /> Convert to Order
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
              <label className="block text-sm font-medium mb-1">Expires At</label>
              <input type="date" value={form.expiresAt ? form.expiresAt.split('T')[0] : ''} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subtotal</label>
              <input type="number" step="0.01" value={form.subtotal || ''} onChange={(e) => setForm({ ...form, subtotal: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Discount</label>
              <input type="number" step="0.01" value={form.discount || ''} onChange={(e) => setForm({ ...form, discount: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tax</label>
              <input type="number" step="0.01" value={form.tax || ''} onChange={(e) => setForm({ ...form, tax: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Total Amount</label>
              <input type="number" step="0.01" value={form.totalAmount || ''} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
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
          {/* Quote Summary */}
          <div className="admin-card p-4 sm:p-6">
            <h2 className="text-sm font-semibold mb-3">Quote Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Created</p>
                <p className="text-sm font-medium">{new Date(quote.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Valid Until</p>
                <p className="text-sm font-medium">{quote.expiresAt ? new Date(quote.expiresAt).toLocaleDateString() : '-'}</p>
              </div>
              {quote.sentAt && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Sent At</p>
                  <p className="text-sm font-medium">{new Date(quote.sentAt).toLocaleDateString()}</p>
                </div>
              )}
              {quote.acceptedAt && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Accepted At</p>
                  <p className="text-sm font-medium text-green-600">{new Date(quote.acceptedAt).toLocaleDateString()}</p>
                </div>
              )}
              {quote.declinedAt && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Declined At</p>
                  <p className="text-sm font-medium text-red-600">{new Date(quote.declinedAt).toLocaleDateString()}</p>
                </div>
              )}
            </div>

            {/* Totals */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="space-y-2 max-w-xs ml-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>${parseFloat(quote.subtotal || '0').toFixed(2)}</span>
                </div>
                {quote.discount && parseFloat(quote.discount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="text-red-600">-${parseFloat(quote.discount).toFixed(2)}</span>
                  </div>
                )}
                {quote.tax && parseFloat(quote.tax) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>${parseFloat(quote.tax).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t border-border pt-2">
                  <span>Total</span>
                  <span className="text-violet-600">${parseFloat(quote.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Contact/Deal */}
          {(quote.contactId || quote.dealId) && (
            <div className="admin-card p-4 sm:p-6">
              <div className="flex gap-6">
                {quote.contactId && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Contact</p>
                    <Link href={`/tenant/contacts/${quote.contactId}`} className="text-sm text-violet-600 hover:underline">
                      View Contact
                    </Link>
                  </div>
                )}
                {quote.dealId && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Deal</p>
                    <Link href={`/tenant/deals/${quote.dealId}`} className="text-sm text-violet-600 hover:underline">
                      View Deal
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Terms */}
          {quote.terms && (
            <div className="admin-card p-4 sm:p-6">
              <h2 className="text-sm font-semibold mb-2">Terms</h2>
              <p className="text-sm whitespace-pre-wrap">{quote.terms}</p>
            </div>
          )}

          {/* Notes */}
          {quote.notes && (
            <div className="admin-card p-4 sm:p-6">
              <h2 className="text-sm font-semibold mb-2">Notes</h2>
              <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
