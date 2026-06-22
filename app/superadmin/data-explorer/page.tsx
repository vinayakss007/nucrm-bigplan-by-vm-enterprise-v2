'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Trash2,
  Edit2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Database,
  Users,
  Building2,
  Target,
  Briefcase,
  Loader2,
  CheckCircle,
  X,
  Copy,
  ArrowUpDown,
  BarChart3,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  results: {
    tenants?: { data: TenantData[]; total: number; page: number; limit: number };
    contacts?: { data: ContactData[]; total: number; page: number; limit: number };
    leads?: { data: LeadData[]; total: number; page: number; limit: number };
    deals?: { data: DealData[]; total: number; page: number; limit: number };
    companies?: { data: CompanyData[]; total: number; page: number; limit: number };
    users?: { data: UserData[]; total: number; page: number; limit: number };
  };
  totalAcrossAll: number;
  query: string;
}

interface PlatformSummary {
  total_tenants: number;
  active_tenants: number;
  trialing_tenants: number;
  suspended_tenants: number;
  total_users: number;
  total_contacts: number;
  total_leads: number;
  total_deals: number;
  total_companies: number;
  total_tasks: number;
  total_pipeline_value: number;
  new_this_week: number;
  new_this_month: number;
}

interface TenantData {
  id: string;
  name: string;
  subdomain: string;
  slug: string;
  status: string;
  plan: string;
  created_at: string;
  owner_email?: string;
  contact_count?: number;
}

interface ContactData {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  company?: string;
  lead_status?: string;
  tenant_name: string;
  tenant_subdomain: string;
  company_name?: string;
  created_at: string;
}

interface LeadData {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  status?: string;
  value?: number;
  tenant_name: string;
  tenant_subdomain: string;
  created_at: string;
}

interface DealData {
  id: string;
  title: string;
  value?: number;
  stage?: string;
  close_date?: string;
  tenant_name: string;
  tenant_subdomain: string;
  contact_name?: string;
  created_at: string;
}

interface CompanyData {
  id: string;
  name: string;
  industry?: string;
  website?: string;
  phone?: string;
  tenant_name: string;
  tenant_subdomain: string;
  contact_count?: number;
  created_at: string;
}

interface UserData {
  id: string;
  email: string;
  full_name?: string;
  is_super_admin: boolean;
  tenant_name?: string;
  tenant_subdomain?: string;
  tenant_role?: string;
  created_at: string;
  last_login_at?: string;
}

// ── Main Page Component ──────────────────────────────────────────────────────

export default function SuperAdminDataExplorer() {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTarget, setEditTarget] = useState<{ table: string; id: string; field: string; value: unknown } | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(true);

  // Load summary on mount
  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      const res = await fetch('/api/superadmin/data-explorer?action=summary');
      const data = await res.json();
      if (data.summary) setSummary(data.summary);
    } catch (err) {
      console.error('Failed to load summary:', err);
    }
  };

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setShowSummary(false);
    try {
      const params = new URLSearchParams({
        q: query,
        type: searchType,
        page: String(page),
        limit: '50',
      });
      if (tenantFilter) params.set('tenantId', tenantFilter);

      const res = await fetch(`/api/superadmin/data-explorer?${params}`);
      const data = await res.json();
      setResults(data);
    } catch (err) {
      console.error('Search failed:', err);
    } finally {
      setLoading(false);
    }
  }, [query, searchType, tenantFilter, page]);

  const handleEdit = (table: string, id: string, field: string, currentValue: unknown) => {
    setEditTarget({ table, id, field, value: currentValue });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    try {
      await fetch('/api/superadmin/data-explorer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editTarget),
      });
      setShowEditModal(false);
      setEditTarget(null);
      handleSearch(); // Refresh
    } catch (err) {
      console.error('Edit failed:', err);
    }
  };

  const handleDelete = async (table: string, id: string) => {
    try {
      await fetch('/api/superadmin/data-explorer', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id, softDelete: true }),
      });
      handleSearch(); // Refresh
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatCurrency = (val?: number) => {
    if (!val) return '$0';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
  };

  const timeAgo = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Database className="w-7 h-7 text-blue-400" />
            Data Explorer
          </h1>
          <p className="text-gray-400 mt-1">Search, view, and manage data across all tenants</p>
        </div>
        <button onClick={loadSummary} className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Platform Summary Cards */}
      {showSummary && summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <SummaryCard icon={<Building2 className="w-5 h-5" />} label="Total Tenants" value={summary.total_tenants} color="blue" />
          <SummaryCard icon={<CheckCircle className="w-5 h-5" />} label="Active" value={summary.active_tenants} color="green" />
          <SummaryCard icon={<Users className="w-5 h-5" />} label="Total Users" value={summary.total_users} color="purple" />
          <SummaryCard icon={<Target className="w-5 h-5" />} label="Contacts" value={summary.total_contacts} color="cyan" />
          <SummaryCard icon={<Briefcase className="w-5 h-5" />} label="Deals" value={summary.total_deals} color="amber" />
          <SummaryCard icon={<BarChart3 className="w-5 h-5" />} label="Pipeline" value={formatCurrency(summary.total_pipeline_value)} color="emerald" />
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          {/* Search Input */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search across ALL tenants — name, email, phone, company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Type Filter */}
          <select
            value={searchType}
            onChange={(e) => setSearchType(e.target.value)}
            className="px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="tenants">Tenants</option>
            <option value="contacts">Contacts</option>
            <option value="leads">Leads</option>
            <option value="deals">Deals</option>
            <option value="companies">Companies</option>
            <option value="users">Users</option>
          </select>

          {/* Tenant Filter */}
          <input
            type="text"
            placeholder="Filter by tenant ID (optional)"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 md:w-64"
          />

          {/* Search Button */}
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 rounded-lg text-white font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Search
          </button>
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="ml-3 text-gray-400">Searching across all tenants…</span>
        </div>
      )}

      {!loading && results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">
              {results.totalAcrossAll.toLocaleString()} records found
              {results.query && ` for "${results.query}"`}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 && (
                <button onClick={() => { setPage(p => p - 1); }} className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded flex items-center gap-1">
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
              )}
              <span className="text-sm text-gray-400">Page {page}</span>
              <button onClick={() => { setPage(p => p + 1); }} className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded flex items-center gap-1">
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tenants Table */}
          {results.results.tenants && results.results.tenants.data.length > 0 && (
            <DataTable
              title="Tenants"
              icon={<Building2 className="w-4 h-4" />}
              count={results.results.tenants.total}
              isExpanded={expandedTable === 'tenants'}
              onToggle={() => setExpandedTable(expandedTable === 'tenants' ? null : 'tenants')}
              columns={['ID', 'Name', 'Subdomain', 'Plan', 'Status', 'Contacts', 'Created', 'Actions']}
              data={results.results.tenants.data.slice(0, expandedTable === 'tenants' ? undefined : 5)}
              renderRow={(item: TenantData) => (
                <>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{item.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-sm font-medium text-white">{item.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.subdomain}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    <span className="px-2 py-0.5 bg-blue-900/50 text-blue-300 rounded text-xs">{item.plan || 'Free'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.contact_count || 0}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(item.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => copyToClipboard(item.id)} title="Copy ID" className="p-1 hover:bg-gray-700 rounded">
                        <Copy className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    </div>
                  </td>
                </>
              )}
            />
          )}

          {/* Contacts Table */}
          {results.results.contacts && results.results.contacts.data.length > 0 && (
            <DataTable
              title="Contacts"
              icon={<Users className="w-4 h-4" />}
              count={results.results.contacts.total}
              isExpanded={expandedTable === 'contacts'}
              onToggle={() => setExpandedTable(expandedTable === 'contacts' ? null : 'contacts')}
              columns={['Name', 'Email', 'Phone', 'Tenant', 'Status', 'Created', 'Actions']}
              data={results.results.contacts.data.slice(0, expandedTable === 'contacts' ? undefined : 5)}
              renderRow={(item: ContactData) => (
                <>
                  <td className="px-4 py-3 text-sm font-medium text-white">{item.first_name} {item.last_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-300 flex items-center gap-1">
                    {item.email}
                    <button onClick={() => copyToClipboard(item.email)} className="p-0.5 hover:bg-gray-700 rounded">
                      <Copy className="w-3 h-3 text-gray-500" />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded text-xs">{item.tenant_name}</span>
                  </td>
                  <td className="px-4 py-3">
                    {item.lead_status && <span className="px-2 py-0.5 bg-gray-800 text-gray-300 rounded text-xs">{item.lead_status}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{timeAgo(item.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEdit('contacts', item.id, 'email', item.email)} title="Edit" className="p-1 hover:bg-gray-700 rounded">
                        <Edit2 className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                      <button onClick={() => handleDelete('contacts', item.id)} title="Delete" className="p-1 hover:bg-gray-700 rounded">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </>
              )}
            />
          )}

          {/* Leads Table */}
          {results.results.leads && results.results.leads.data.length > 0 && (
            <DataTable
              title="Leads"
              icon={<Target className="w-4 h-4" />}
              count={results.results.leads.total}
              isExpanded={expandedTable === 'leads'}
              onToggle={() => setExpandedTable(expandedTable === 'leads' ? null : 'leads')}
              columns={['Name', 'Email', 'Company', 'Tenant', 'Value', 'Status', 'Actions']}
              data={results.results.leads.data.slice(0, expandedTable === 'leads' ? undefined : 5)}
              renderRow={(item: LeadData) => (
                <>
                  <td className="px-4 py-3 text-sm font-medium text-white">{item.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.email || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.company || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded text-xs">{item.tenant_name}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.value ? formatCurrency(item.value) : '—'}</td>
                  <td className="px-4 py-3">
                    {item.status && <span className="px-2 py-0.5 bg-gray-800 text-gray-300 rounded text-xs">{item.status}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEdit('leads', item.id, 'status', item.status)} title="Edit" className="p-1 hover:bg-gray-700 rounded">
                        <Edit2 className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                      <button onClick={() => handleDelete('leads', item.id)} title="Delete" className="p-1 hover:bg-gray-700 rounded">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </>
              )}
            />
          )}

          {/* Deals Table */}
          {results.results.deals && results.results.deals.data.length > 0 && (
            <DataTable
              title="Deals"
              icon={<Briefcase className="w-4 h-4" />}
              count={results.results.deals.total}
              isExpanded={expandedTable === 'deals'}
              onToggle={() => setExpandedTable(expandedTable === 'deals' ? null : 'deals')}
              columns={['Title', 'Contact', 'Value', 'Stage', 'Tenant', 'Close Date', 'Actions']}
              data={results.results.deals.data.slice(0, expandedTable === 'deals' ? undefined : 5)}
              renderRow={(item: DealData) => (
                <>
                  <td className="px-4 py-3 text-sm font-medium text-white">{item.title}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.contact_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-green-400 font-medium">{formatCurrency(item.value)}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.stage || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded text-xs">{item.tenant_name}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{item.close_date ? new Date(item.close_date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEdit('deals', item.id, 'stage', item.stage)} title="Edit" className="p-1 hover:bg-gray-700 rounded">
                        <Edit2 className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                      <button onClick={() => handleDelete('deals', item.id)} title="Delete" className="p-1 hover:bg-gray-700 rounded">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </>
              )}
            />
          )}

          {/* Companies Table */}
          {results.results.companies && results.results.companies.data.length > 0 && (
            <DataTable
              title="Companies"
              icon={<Building2 className="w-4 h-4" />}
              count={results.results.companies.total}
              isExpanded={expandedTable === 'companies'}
              onToggle={() => setExpandedTable(expandedTable === 'companies' ? null : 'companies')}
              columns={['Name', 'Industry', 'Contacts', 'Tenant', 'Website', 'Actions']}
              data={results.results.companies.data.slice(0, expandedTable === 'companies' ? undefined : 5)}
              renderRow={(item: CompanyData) => (
                <>
                  <td className="px-4 py-3 text-sm font-medium text-white">{item.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.industry || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.contact_count || 0}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded text-xs">{item.tenant_name}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[200px]">{item.website || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEdit('companies', item.id, 'name', item.name)} title="Edit" className="p-1 hover:bg-gray-700 rounded">
                        <Edit2 className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                      <button onClick={() => handleDelete('companies', item.id)} title="Delete" className="p-1 hover:bg-gray-700 rounded">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </>
              )}
            />
          )}

          {/* Users Table */}
          {results.results.users && results.results.users.data.length > 0 && (
            <DataTable
              title="Users"
              icon={<Users className="w-4 h-4" />}
              count={results.results.users.total}
              isExpanded={expandedTable === 'users'}
              onToggle={() => setExpandedTable(expandedTable === 'users' ? null : 'users')}
              columns={['Email', 'Name', 'Tenant', 'Role', 'Super Admin', 'Last Login', 'Actions']}
              data={results.results.users.data.slice(0, expandedTable === 'users' ? undefined : 5)}
              renderRow={(item: UserData) => (
                <>
                  <td className="px-4 py-3 text-sm text-gray-300 flex items-center gap-1">
                    {item.email}
                    <button onClick={() => copyToClipboard(item.email)} className="p-0.5 hover:bg-gray-700 rounded">
                      <Copy className="w-3 h-3 text-gray-500" />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{item.full_name || '—'}</td>
                  <td className="px-4 py-3">
                    {item.tenant_name ? (
                      <span className="px-2 py-0.5 bg-purple-900/50 text-purple-300 rounded text-xs">{item.tenant_name}</span>
                    ) : (
                      <span className="text-gray-500 text-xs">No tenant</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">{item.tenant_role || '—'}</td>
                  <td className="px-4 py-3">
                    {item.is_super_admin ? (
                      <span className="px-2 py-0.5 bg-red-900/50 text-red-300 rounded text-xs">Yes</span>
                    ) : (
                      <span className="text-gray-500 text-xs">No</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{item.last_login_at ? timeAgo(item.last_login_at) : 'Never'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEdit('users', item.id, 'full_name', item.full_name)} title="Edit" className="p-1 hover:bg-gray-700 rounded">
                        <Edit2 className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                    </div>
                  </td>
                </>
              )}
            />
          )}

          {/* No Results */}
          {results.totalAcrossAll === 0 && (
            <div className="text-center py-16 bg-gray-900 rounded-xl border border-gray-800">
              <Search className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 text-lg">No results found</p>
              <p className="text-gray-500 text-sm mt-1">Try a different search term or broaden your filters</p>
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-blue-400" />
                Edit Record
              </h3>
              <button onClick={() => setShowEditModal(false)} className="p-1 hover:bg-gray-800 rounded">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 uppercase">Table</label>
                <p className="text-sm text-white font-mono bg-gray-800 px-3 py-1.5 rounded">{editTarget.table}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase">ID</label>
                <p className="text-xs text-gray-400 font-mono bg-gray-800 px-3 py-1.5 rounded">{editTarget.id}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase">Field</label>
                <p className="text-sm text-white font-mono bg-gray-800 px-3 py-1.5 rounded">{editTarget.field}</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase">New Value</label>
                <input
                  type="text"
                   value={String(editTarget.value ?? '')}
                  onChange={(e) => setEditTarget({ ...editTarget, value: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowEditModal(false)} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white">
                Cancel
              </button>
              <button onClick={handleSaveEdit} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-medium">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500/20 to-blue-600/5 border-blue-800',
    green: 'from-green-500/20 to-green-600/5 border-green-800',
    purple: 'from-purple-500/20 to-purple-600/5 border-purple-800',
    cyan: 'from-cyan-500/20 to-cyan-600/5 border-cyan-800',
    amber: 'from-amber-500/20 to-amber-600/5 border-amber-800',
    emerald: 'from-emerald-500/20 to-emerald-600/5 border-emerald-800',
  };

  return (
    <div className={`bg-gradient-to-br ${colorMap[color] || colorMap['blue']} border rounded-lg p-4`}>
      <div className="flex items-center gap-2 text-gray-400 mb-1">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-900/50 text-green-300',
    trialing: 'bg-blue-900/50 text-blue-300',
    suspended: 'bg-red-900/50 text-red-300',
    inactive: 'bg-gray-800 text-gray-400',
    expired: 'bg-amber-900/50 text-amber-300',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs ${colors[status] || 'bg-gray-800 text-gray-400'}`}>
      {status}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DataTable({ title, icon, count, isExpanded, onToggle, columns, data, renderRow }: {
  title: string;
  icon: React.ReactNode;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  columns: string[];
  data: Record<string, unknown>[];
  renderRow: (item: Record<string, unknown>) => React.ReactNode;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-white">{title}</span>
          <span className="px-2 py-0.5 bg-gray-800 text-gray-400 rounded-full text-xs">{count.toLocaleString()}</span>
        </div>
        <ArrowUpDown className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {isExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-t border-gray-800">
                {columns.map(col => (
                  <th key={col} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {data.map((item, i) => (
                <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                  {renderRow(item)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
