'use client';
import { useState, useEffect } from 'react';
import { FileSignature, Plus, X, Loader2, Trash2, UserPlus } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface SigningRequest {
  id: string;
  documentId: string;
  provider: string;
  status: string;
  signers: { name: string; email: string }[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface Signer {
  name: string;
  email: string;
}

const STATUS_FILTERS = ['all', 'pending', 'sent', 'viewed', 'signed', 'declined', 'expired'] as const;
const PROVIDERS = ['docusign', 'hellosign', 'internal'] as const;

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  viewed: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
  signed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  expired: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
};

const providerColors: Record<string, string> = {
  docusign: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
  hellosign: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  internal: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
};

export default function EsignaturePage() {
  const [requests, setRequests] = useState<SigningRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    documentId: '',
    provider: 'internal' as string,
    signers: [{ name: '', email: '' }] as Signer[],
  });

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/tenant/esignature?${params}`);
      if (res.ok) {
        const d = await res.json();
        setRequests(d.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter, load]);

  const openCreate = () => {
    setForm({ documentId: '', provider: 'internal', signers: [{ name: '', email: '' }] });
    setShowCreate(true);
  };

  const addSigner = () => {
    setForm(f => ({ ...f, signers: [...f.signers, { name: '', email: '' }] }));
  };

  const removeSigner = (idx: number) => {
    setForm(f => ({ ...f, signers: f.signers.filter((_, i) => i !== idx) }));
  };

  const updateSigner = (idx: number, field: keyof Signer, value: string) => {
    setForm(f => ({
      ...f,
      signers: f.signers.map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.signers.some(s => !s.name || !s.email)) {
      toast.error('All signers must have name and email');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/esignature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: form.documentId,
          provider: form.provider,
          signers: form.signers,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        toast.success('Signing request created');
        setShowCreate(false);
        load();
      } else {
        toast.error(d.error || 'Failed to create signing request');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">E-Signatures</h1>
          <p className="text-sm text-muted-foreground">Manage document signing requests</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          <Plus className="w-4 h-4" />New Request
        </button>
      </div>

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              filter === s ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-accent')}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Requests Table */}
      {loading ? (
        [...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-2xl animate-pulse" />)
      ) : requests.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-2xl">
          <FileSignature className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No signing requests</p>
          <p className="text-sm text-muted-foreground mt-1">Create a signing request to get documents signed</p>
          <button onClick={openCreate} className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold mx-auto">
            <Plus className="w-4 h-4" />New Request
          </button>
        </div>
      ) : (
        <div className="admin-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Document</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Signers</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Provider</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="px-4 py-3 font-mono text-xs">{r.documentId}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium">{Array.isArray(r.signers) ? r.signers.length : 0} signer{Array.isArray(r.signers) && r.signers.length !== 1 ? 's' : ''}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', providerColors[r.provider] || 'bg-muted text-muted-foreground')}>
                      {r.provider}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', statusColors[r.status] || 'bg-muted text-muted-foreground')}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">New Signing Request</h3>
              <button onClick={() => setShowCreate(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Document ID *</label>
                <input value={form.documentId} onChange={e => setForm(f => ({ ...f, documentId: e.target.value }))} required className={inp} placeholder="Enter document ID" />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Provider *</label>
                <select value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} className={inp}>
                  {PROVIDERS.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-muted-foreground">Signers *</label>
                  <button type="button" onClick={addSigner}
                    className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 font-medium">
                    <UserPlus className="w-3 h-3" />Add Signer
                  </button>
                </div>
                <div className="space-y-2">
                  {form.signers.map((s, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input value={s.name} onChange={e => updateSigner(idx, 'name', e.target.value)}
                        required className={inp} placeholder="Name" />
                      <input value={s.email} onChange={e => updateSigner(idx, 'email', e.target.value)}
                        required type="email" className={inp} placeholder="Email" />
                      {form.signers.length > 1 && (
                        <button type="button" onClick={() => removeSigner(idx)} className="text-muted-foreground hover:text-red-500 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent">Cancel</button>
                <button type="submit" disabled={saving || !form.documentId || form.signers.length === 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Create Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
