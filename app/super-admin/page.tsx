'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  Building2, Users, Activity, Shield, 
  Search, Eye, CheckCircle, TrendingUp
} from 'lucide-react';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  ownerEmail: string;
  ownerName: string;
  currentUsers: number;
  currentContacts: number;
  currentDeals: number;
  createdAt: string;
}

interface AuditLog {
  id: string;
  admin_id: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string;
  tenant_name: string;
  created_at: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: any;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  trialing: 'bg-blue-100 text-blue-700',
  suspended: 'bg-red-100 text-red-700',
  deleted: 'bg-gray-100 text-gray-700',
  inactive: 'bg-gray-100 text-gray-700',
};

const ACTION_LABELS: Record<string, string> = {
  'tenant.created': 'Tenant Created',
  'tenant.suspended': 'Tenant Suspended',
  'tenant.reactivated': 'Tenant Reactivated',
  'tenant.deleted': 'Tenant Deleted',
  'tenant.plan_changed': 'Plan Changed',
  'user.impersonation_started': 'Impersonation Started',
  'user.impersonation_ended': 'Impersonation Ended',
  'user.suspended': 'User Suspended',
  'user.deleted': 'User Deleted',
  'login.success': 'Admin Login',
  'login.failed': 'Failed Login',
};

export default function SuperAdminDashboard() {
  const [activeTab, setActiveTab] = useState<'tenants' | 'audit'>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({
    totalTenants: 0,
    activeTenants: 0,
    totalUsers: 0,
    newThisMonth: 0,
  });

  const loadTenants = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      params.set('limit', '50');

      const res = await fetch(`/api/super-admin/tenants?${params}`);
      const data = await res.json();
      setTenants(data.data || []);
      setStats({
        totalTenants: data.total || 0,
        activeTenants: data.data?.filter((t: Tenant) => t.status === 'active').length || 0,
        totalUsers: data.data?.reduce((sum: number, t: Tenant) => sum + (t.currentUsers || 0), 0) || 0,
        newThisMonth: data.data?.filter((t: Tenant) => {
          const created = new Date(t.createdAt);
          const monthAgo = new Date();
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          return created > monthAgo;
        }).length || 0,
      });
    } catch (err) {
      console.error('Failed to load tenants:', err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadAuditLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '50');

      const res = await fetch(`/api/super-admin/audit-logs?${params}`);
      const data = await res.json();
      setAuditLogs(data.data || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    if (activeTab === 'tenants') {
      loadTenants();
    } else {
      loadAuditLogs();
    }
  }, [activeTab, loadTenants, loadAuditLogs]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Super Admin</h1>
                <p className="text-sm text-muted-foreground">Platform Administration</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="p-4 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalTenants}</p>
                <p className="text-xs text-muted-foreground">Total Tenants</p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.activeTenants}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.totalUsers}</p>
                <p className="text-xs text-muted-foreground">Total Users</p>
              </div>
            </div>
          </div>
          <div className="p-4 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.newThisMonth}</p>
                <p className="text-xs text-muted-foreground">New This Month</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b border-border mb-6">
          <button
            onClick={() => setActiveTab('tenants')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'tenants'
                ? 'border-violet-600 text-violet-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="w-4 h-4 inline mr-2" />
            Tenants
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'audit'
                ? 'border-violet-600 text-violet-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Activity className="w-4 h-4 inline mr-2" />
            Audit Logs
          </button>
        </div>

        {/* Search (for tenants) */}
        {activeTab === 'tenants' && (
          <div className="flex gap-4 mb-6">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search tenants..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : activeTab === 'tenants' ? (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Tenant</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Owner</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Users</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Contacts</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Created</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium">{tenant.name}</p>
                        <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">{tenant.ownerEmail}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[tenant.status] || STATUS_COLORS['inactive']}`}>
                        {tenant.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{tenant.currentUsers || 0}</td>
                    <td className="px-4 py-3 text-sm">{tenant.currentContacts || 0}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(tenant.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/tenant/${tenant.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No tenants found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Admin</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Target</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Tenant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">{log.admin_email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {log.target_type ? `${log.target_type}: ${log.target_id?.slice(0, 8)}...` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {log.tenant_name || '-'}
                    </td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No audit logs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}