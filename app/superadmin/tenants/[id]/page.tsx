/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2, Mail, Users, Calendar, Shield, Edit, Save, Loader2, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

interface Tenant {
  id: string;
  name: string;
  slug?: string;
  plan_id: string;
  plan_name?: string;
  status: string;
  billing_type?: string;
  billing_email?: string;
  stripe_customer_id?: string;
  owner_name?: string;
  owner_email?: string;
  created_at: string;
  trial_ends_at?: string;
  manual_paid_until?: string;
  primary_color?: string;
  admin_notes?: string;
  member_count?: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  trialing: 'bg-amber-500/15 text-amber-400',
  suspended: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-slate-500/15 text-slate-400',
};

export default function TenantDetailPage() {
  const params = useParams();
  const tenantId = params['id'] as string;
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    plan_id: '',
    status: '',
    billing_email: '',
    admin_notes: '',
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/superadmin/tenants/${tenantId}`, { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      if (signal?.aborted) return;
      setTenant(data.data);
      setForm({
        plan_id: data.data.plan_id || 'free',
        status: data.data.status || 'trialing',
        billing_email: data.data.billing_email || '',
        admin_notes: data.data.admin_notes || '',
      });
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      toast.error(err instanceof Error ? err.message : 'Failed to load tenant');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/superadmin/tenants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tenantId, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      toast.success('Tenant updated');
      setEditing(false);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-4">
        <Link href="/superadmin/tenants" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Tenants
        </Link>
        <div className="admin-card p-8 text-center">
          <p className="text-muted-foreground">Tenant not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/superadmin/tenants" className="p-2 rounded-lg hover:bg-accent text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-violet-500" />
            {tenant.name}
          </h1>
          {tenant.slug && <p className="text-sm text-muted-foreground">Slug: {tenant.slug}</p>}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/superadmin/tenants/${tenantId}/roles`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
          >
            <Shield className="w-4 h-4" /> Roles
          </Link>
          <Link
            href={`/superadmin/tenants/${tenantId}/settings`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-accent"
          >
            <ExternalLink className="w-4 h-4" /> Settings
          </Link>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm"
            >
              <Edit className="w-4 h-4" /> Edit
            </button>
          )}
        </div>
      </div>

      {/* Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status & Plan */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Status & Plan</h3>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-transparent text-sm"
                >
                  {['active', 'trialing', 'suspended', 'cancelled'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Plan</label>
                <select
                  value={form.plan_id}
                  onChange={e => setForm(f => ({ ...f, plan_id: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-transparent text-sm"
                >
                  {['free', 'starter', 'pro', 'enterprise'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[tenant.status] || 'bg-slate-500/15 text-slate-400'}`}>
                  {tenant.status}
                </span>
                <span className="text-sm text-muted-foreground capitalize">{tenant.plan_name || tenant.plan_id} plan</span>
              </div>
              {tenant.billing_type && (
                <p className="text-sm">Billing: <span className="capitalize">{tenant.billing_type}</span></p>
              )}
            </div>
          )}
        </div>

        {/* Owner */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Owner</h3>
          {tenant.owner_name && (
            <p className="text-sm font-medium">{tenant.owner_name}</p>
          )}
          {tenant.owner_email && (
            <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
              <Mail className="w-3.5 h-3.5" /> {tenant.owner_email}
            </p>
          )}
          {tenant.billing_email && tenant.billing_email !== tenant.owner_email && (
            <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
              <Mail className="w-3.5 h-3.5" /> Billing: {tenant.billing_email}
            </p>
          )}
        </div>

        {/* Members */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Members</h3>
          <p className="text-sm flex items-center gap-1.5">
            <Users className="w-4 h-4 text-muted-foreground" />
            {tenant.member_count ?? '—'} members
          </p>
        </div>

        {/* Dates */}
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Dates</h3>
          <p className="text-sm flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            Created: {tenant.created_at ? new Date(tenant.created_at).toLocaleDateString() : '—'}
          </p>
          {tenant.trial_ends_at && (
            <p className="text-sm text-muted-foreground">
              Trial ends: {new Date(tenant.trial_ends_at).toLocaleDateString()}
            </p>
          )}
          {tenant.manual_paid_until && (
            <p className="text-sm text-muted-foreground">
              Paid until: {new Date(tenant.manual_paid_until).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Admin Notes */}
      <div className="admin-card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">Admin Notes</h3>
        {editing ? (
          <textarea
            value={form.admin_notes}
            onChange={e => setForm(f => ({ ...f, admin_notes: e.target.value }))}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="Internal notes about this tenant..."
          />
        ) : (
          <p className="text-sm text-muted-foreground">{tenant.admin_notes || 'No notes'}</p>
        )}
      </div>

      {/* Billing Email Edit */}
      {editing && (
        <div className="admin-card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Billing Email</h3>
          <input
            type="email"
            value={form.billing_email}
            onChange={e => setForm(f => ({ ...f, billing_email: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="billing@example.com"
          />
        </div>
      )}

      {/* Save / Cancel */}
      {editing && (
        <div className="flex gap-3">
          <button
            onClick={() => setEditing(false)}
            className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}
