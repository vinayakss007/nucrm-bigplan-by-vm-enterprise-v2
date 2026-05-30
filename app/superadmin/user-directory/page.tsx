'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Search, Download, ChevronLeft, ChevronRight, Building2 } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Membership {
  tenant_id: string;
  tenant_name: string;
  plan: string;
  role_slug: string;
  status: string;
}

interface UserRecord {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  email_verified: boolean;
  is_super_admin: boolean;
  created_at: string;
  memberships: Membership[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

interface Tenant {
  id: string;
  name: string;
  plan_id?: string;
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-slate-500/15 text-slate-400',
  starter: 'bg-blue-500/15 text-blue-400',
  pro: 'bg-violet-500/15 text-violet-400',
  enterprise: 'bg-amber-500/15 text-amber-400',
};

export default function SuperAdminUserDirectoryPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, total_pages: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Fetch tenants for filter dropdown
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const res = await fetch('/api/superadmin/tenants');
        const d = await res.json();
        setTenants(d.data || d.tenants || []);
      } catch { /* ignore */ }
    };
    fetchTenants();
  }, []);

  // Fetch users
  const fetchUsers = useCallback(async (page: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '50');
    if (debouncedSearch) params.set('q', debouncedSearch);
    if (tenantFilter) params.set('tenant_id', tenantFilter);

    try {
      const res = await fetch(`/api/superadmin/user-directory?${params.toString()}`);
      const d = await res.json();
      setUsers(d.data || []);
      setPagination(d.pagination || { page: 1, limit: 50, total: 0, total_pages: 0 });
    } catch {
      toast.error('Failed to load users');
    }
    setLoading(false);
  }, [debouncedSearch, tenantFilter]);

  useEffect(() => {
    fetchUsers(1);
  }, [fetchUsers]);

  const goToPage = (page: number) => {
    if (page < 1 || page > pagination.total_pages) return;
    fetchUsers(page);
  };

  const exportCSV = () => {
    if (!users.length) { toast.error('No data to export'); return; }
    const headers = ['Name', 'Email', 'Phone', 'Tenants', 'Plan', 'Joined', 'Status'];
    const rows = users.map(u => [
      u.full_name || '',
      u.email,
      u.phone || '',
      (u.memberships || []).map(m => m.tenant_name).join('; '),
      (u.memberships || []).map(m => m.plan).join('; '),
      u.created_at ? new Date(u.created_at).toLocaleDateString() : '',
      u.is_super_admin ? 'Super Admin' : 'Active',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `user-directory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${users.length} users`);
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-violet-400" />User Directory
          </h1>
          <p className="text-xs text-white/40 mt-0.5">
            {pagination.total} users across all tenants
          </p>
        </div>
        <button onClick={exportCSV}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold transition-colors">
          <Download className="w-4 h-4" />Export CSV
        </button>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
          />
        </div>
        <select
          value={tenantFilter}
          onChange={e => setTenantFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02] text-sm text-white focus:outline-none focus:border-violet-500 max-w-xs"
        >
          <option value="" className="bg-zinc-900">All Tenants</option>
          {tenants.map(t => (
            <option key={t.id} value={t.id} className="bg-zinc-900">{t.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              {['User', 'Email', 'Phone', 'Tenant(s)', 'Joined', 'Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-white/40 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center py-12 text-white/40 text-sm">Loading...</td></tr>
            )}
            {!loading && !users.length && (
              <tr><td colSpan={6} className="text-center py-12 text-white/40 text-sm">No users found</td></tr>
            )}
            {!loading && users.map(u => (
              <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {(u.full_name || u.email)?.charAt(0)?.toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-white">{u.full_name || '-'}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-white/60">{u.email}</td>
                <td className="px-4 py-3 text-xs text-white/60">{u.phone || '-'}</td>
                <td className="px-4 py-3">
                  {(u.memberships || []).slice(0, 2).map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5 mb-0.5">
                      <Building2 className="w-3 h-3 text-white/30" />
                      <span className="text-xs text-white/60">{m.tenant_name}</span>
                      <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full capitalize', PLAN_COLORS[m.plan] || 'bg-white/10 text-white/40')}>
                        {m.plan}
                      </span>
                    </div>
                  ))}
                  {(u.memberships || []).length > 2 && (
                    <p className="text-[10px] text-white/30">+{u.memberships.length - 2} more</p>
                  )}
                  {!u.memberships?.length && <span className="text-xs text-white/20">No tenant</span>}
                </td>
                <td className="px-4 py-3 text-xs text-white/40">{formatDate(u.created_at)}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'text-[10px] font-bold px-2 py-0.5 rounded-full',
                    u.is_super_admin ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'
                  )}>
                    {u.is_super_admin ? 'Super Admin' : 'Active'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-white/40">
            Page {pagination.page} of {pagination.total_pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />Prev
            </button>
            <button
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.total_pages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/60 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next<ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
