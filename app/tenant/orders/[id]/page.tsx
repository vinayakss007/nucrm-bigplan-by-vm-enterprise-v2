'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Edit2, Trash2, Save, X, Package, Truck, CheckCircle, Clock, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Order {
  id: string;
  orderNumber: string;
  title: string | null;
  status: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  subtotal: string;
  discountAmount: string | null;
  taxAmount: string | null;
  shippingAmount: string | null;
  totalAmount: string;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingCountry: string | null;
  shippingPostalCode: string | null;
  trackingNumber: string | null;
  shippingCarrier: string | null;
  notes: string | null;
  customerNotes: string | null;
  contactId: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  confirmed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  processing: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  shipped: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  delivered: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const statusFlow = ['draft', 'confirmed', 'processing', 'shipped', 'delivered'];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Order>>({});

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/tenant/orders/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setOrder(data.data);
      } catch {
        toast.error('Failed to load order');
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [id]);

  const handleEdit = () => {
    if (order) {
      setForm({
        title: order.title,
        expectedDeliveryDate: order.expectedDeliveryDate,
        trackingNumber: order.trackingNumber,
        shippingCarrier: order.shippingCarrier,
        shippingAddress: order.shippingAddress,
        shippingCity: order.shippingCity,
        shippingState: order.shippingState,
        shippingCountry: order.shippingCountry,
        shippingPostalCode: order.shippingPostalCode,
        notes: order.notes,
      });
      setEditing(true);
    }
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tenant/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      setOrder(data.data);
      setEditing(false);
      toast.success('Order updated');
    } catch {
      toast.error('Failed to update order');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const res = await fetch(`/api/tenant/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setOrder(data.data);
      toast.success(`Order marked as ${newStatus}`);
    } catch {
      toast.error('Failed to change status');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this order?')) return;
    try {
      const res = await fetch(`/api/tenant/orders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Order deleted');
      router.push('/tenant/orders');
    } catch {
      toast.error('Failed to delete order');
    }
  };

  const getNextStatus = () => {
    if (!order) return null;
    const idx = statusFlow.indexOf(order.status);
    if (idx === -1 || idx >= statusFlow.length - 1) return null;
    return statusFlow[idx + 1];
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

  if (!order) {
    return (
      <div className="text-center py-12">
        <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-lg font-semibold">Order not found</p>
        <Link href="/tenant/orders" className="text-sm text-violet-600 hover:underline mt-2 inline-block">Back to orders</Link>
      </div>
    );
  }

  const nextStatus = getNextStatus();

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      {/* Back button */}
      <Link href="/tenant/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Orders
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-bold">Order #{order.orderNumber}</h1>
            <span className={cn('px-2 py-1 text-xs rounded-full font-medium', statusColors[order.status])}>{order.status}</span>
          </div>
          {order.title && <p className="text-sm text-muted-foreground mt-1">{order.title}</p>}
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

      {/* Status Progression */}
      <div className="admin-card p-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {statusFlow.map((status, idx) => {
            const currentIdx = statusFlow.indexOf(order.status);
            const isComplete = idx <= currentIdx;
            const isCurrent = idx === currentIdx;
            return (
              <div key={status} className="flex items-center gap-2">
                <div className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap',
                  isCurrent ? statusColors[status] : isComplete ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'
                )}>
                  {isComplete && !isCurrent ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  <span className="capitalize">{status}</span>
                </div>
                {idx < statusFlow.length - 1 && <div className={cn('w-4 h-0.5', isComplete ? 'bg-green-300' : 'bg-muted')} />}
              </div>
            );
          })}
        </div>
        {nextStatus && order.status !== 'cancelled' && (
          <div className="mt-3 pt-3 border-t border-border">
            <button onClick={() => handleStatusChange(nextStatus)} className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 capitalize transition-colors">
              Move to {nextStatus}
            </button>
            {order.status !== 'delivered' && (
              <button onClick={() => handleStatusChange('cancelled')} className="ml-2 px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors">
                Cancel Order
              </button>
            )}
          </div>
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
              <label className="block text-sm font-medium mb-1">Expected Delivery</label>
              <input type="date" value={form.expectedDeliveryDate || ''} onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tracking Number</label>
              <input type="text" value={form.trackingNumber || ''} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Shipping Carrier</label>
              <input type="text" value={form.shippingCarrier || ''} onChange={(e) => setForm({ ...form, shippingCarrier: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Shipping Address</label>
            <input type="text" value={form.shippingAddress || ''} onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input type="text" value={form.shippingCity || ''} onChange={(e) => setForm({ ...form, shippingCity: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <input type="text" value={form.shippingState || ''} onChange={(e) => setForm({ ...form, shippingState: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Country</label>
              <input type="text" value={form.shippingCountry || ''} onChange={(e) => setForm({ ...form, shippingCountry: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Postal Code</label>
              <input type="text" value={form.shippingPostalCode || ''} onChange={(e) => setForm({ ...form, shippingPostalCode: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm" />
            </div>
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
          {/* Order Summary */}
          <div className="admin-card p-4 sm:p-6">
            <h2 className="text-sm font-semibold mb-3">Order Summary</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Order Date</p>
                <p className="text-sm font-medium">{new Date(order.orderDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Expected Delivery</p>
                <p className="text-sm font-medium">{order.expectedDeliveryDate ? new Date(order.expectedDeliveryDate).toLocaleDateString() : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Created</p>
                <p className="text-sm font-medium">{new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
            </div>

            {/* Totals */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="space-y-2 max-w-xs ml-auto">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>${parseFloat(order.subtotal).toFixed(2)}</span>
                </div>
                {order.discountAmount && parseFloat(order.discountAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="text-red-600">-${parseFloat(order.discountAmount).toFixed(2)}</span>
                  </div>
                )}
                {order.taxAmount && parseFloat(order.taxAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax</span>
                    <span>${parseFloat(order.taxAmount).toFixed(2)}</span>
                  </div>
                )}
                {order.shippingAmount && parseFloat(order.shippingAmount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Shipping</span>
                    <span>${parseFloat(order.shippingAmount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t border-border pt-2">
                  <span>Total</span>
                  <span className="text-violet-600">${parseFloat(order.totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Shipping Info */}
          {(order.shippingAddress || order.trackingNumber) && (
            <div className="admin-card p-4 sm:p-6">
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2"><Truck className="w-4 h-4" /> Shipping Info</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {order.shippingAddress && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Address</p>
                    <p className="text-sm">{order.shippingAddress}</p>
                    <p className="text-sm">{[order.shippingCity, order.shippingState, order.shippingPostalCode].filter(Boolean).join(', ')}</p>
                    {order.shippingCountry && <p className="text-sm">{order.shippingCountry}</p>}
                  </div>
                )}
                {order.trackingNumber && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Tracking</p>
                    <p className="text-sm font-mono">{order.trackingNumber}</p>
                    {order.shippingCarrier && <p className="text-xs text-muted-foreground">{order.shippingCarrier}</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Contact */}
          {order.contactId && (
            <div className="admin-card p-4 sm:p-6">
              <p className="text-xs text-muted-foreground mb-1">Contact</p>
              <Link href={`/tenant/contacts/${order.contactId}`} className="text-sm text-violet-600 hover:underline">
                View Contact
              </Link>
            </div>
          )}

          {/* Notes */}
          {(order.notes || order.customerNotes) && (
            <div className="admin-card p-4 sm:p-6">
              {order.notes && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Internal Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
                </div>
              )}
              {order.customerNotes && (
                <div className={order.notes ? 'mt-4 pt-4 border-t border-border' : ''}>
                  <p className="text-xs text-muted-foreground mb-2">Customer Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{order.customerNotes}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
