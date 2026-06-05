'use client';
import { useState, useEffect } from 'react';
import { Plus, Receipt, X, Loader2, Trash2, Pencil, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface TaxRate {
  id: string;
  name: string;
  rate: number;
  type: 'percentage' | 'fixed';
  country: string | null;
  state: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export default function TaxSettingsPage() {
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TaxRate | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    rate: 0,
    type: 'percentage' as 'percentage' | 'fixed',
    country: '',
    state: '',
    isDefault: false,
  });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/tax');
      if (res.ok) {
        const d = await res.json();
        setRates(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', rate: 0, type: 'percentage', country: '', state: '', isDefault: false });
    setShowModal(true);
  };

  const openEdit = (r: TaxRate) => {
    setEditing(r);
    setForm({
      name: r.name,
      rate: r.rate,
      type: r.type,
      country: r.country || '',
      state: r.state || '',
      isDefault: r.isDefault,
    });
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        rate: form.rate,
        type: form.type,
        isDefault: form.isDefault,
        ...(form.country ? { country: form.country } : {}),
        ...(form.state ? { state: form.state } : {}),
      };

      const res = await fetch('/api/tenant/tax', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success(editing ? 'Tax rate updated' : 'Tax rate created');
        setShowModal(false);
        load();
      } else {
        toast.error(d.error || 'Failed to save');
      }
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    const res = await fetch(`/api/tenant/tax?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      setRates(prev => prev.filter(x => x.id !== id));
      toast.success('Tax rate deleted');
    } else {
      toast.error('Failed to delete');
    }
  };

  const activeRates = rates.filter(r => r.isActive !== false);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Tax Rates</h1>
          <p className="text-sm text-muted-foreground">Configure tax rates for invoices and quotes</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" />Add Tax Rate
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="admin-card p-4">
          <p className="text-xs text-muted-foreground font-medium">Total Rates</p>
          <p className="text-2xl font-bold mt-1">{rates.length}</p>
        </div>
        <div className="admin-card p-4">
          <p className="text-xs text-muted-foreground font-medium">Active Rates</p>
          <p className="text-2xl font-bold mt-1">{activeRates.length}</p>
        </div>
        <div className="admin-card p-4">
          <p className="text-xs text-muted-foreground font-medium">Default Rate</p>
          <p className="text-2xl font-bold mt-1">{rates.find(r => r.isDefault)?.name || 'None'}</p>
        </div>
      </div>

      {loading ? (
        [...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-2xl animate-pulse" />)
      ) : rates.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <Receipt className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No tax rates configured</p>
          <p className="text-sm text-muted-foreground mt-1">Add tax rates to apply them on invoices and quotes</p>
          <button onClick={openCreate} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Plus className="w-4 h-4" />Add Tax Rate
          </button>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Rate</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Country</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">State</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Default</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.type === 'percentage' ? `${r.rate}%` : `$${r.rate}`}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs font-bold px-2 py-0.5 rounded-full',
                      r.type === 'percentage'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                        : 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400'
                    )}>
                      {r.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.country || '-'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.state || '-'}</td>
                  <td className="px-4 py-3">
                    {r.isDefault && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 inline-flex items-center gap-1">
                        <Star className="w-3 h-3" />Default
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(r)} className="text-muted-foreground hover:text-violet-600">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => del(r.id)} className="text-muted-foreground hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{editing ? 'Edit Tax Rate' : 'New Tax Rate'}</h3>
              <button onClick={() => setShowModal(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className={inp} placeholder="e.g. Standard VAT" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Rate *</label>
                  <input type="number" step="0.01" min={0} value={form.rate} onChange={e => setForm(f => ({ ...f, rate: Number(e.target.value) }))} required className={inp} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Type *</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'percentage' | 'fixed' }))} className={inp}>
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Country</label>
                  <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} className={inp} placeholder="e.g. US" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">State</label>
                  <input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} className={inp} placeholder="e.g. CA" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="isDefault" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} className="rounded" />
                <label htmlFor="isDefault" className="text-sm text-muted-foreground">Set as default tax rate</label>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" disabled={saving || !form.name}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
