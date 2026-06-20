'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users, Plus, Download, Upload, Search, MoreHorizontal, Trash2,
  Phone, Building2, Calendar, User, Star, Archive,
  ChevronDown, CheckCircle, XCircle, Zap, Target, Eye, Activity
} from 'lucide-react';
import { cn, formatDate, getInitials } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import ImportModal from '@/components/tenant/import-modal';
import toast from 'react-hot-toast';

// ── Pipeline Configuration ──────────────────────────────────────
const PIPELINE_CONFIG = {
  new: {
    label: 'New',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    dot: 'bg-slate-400',
    icon: Star,
    description: 'Fresh leads that need attention',
  },
  contacted: {
    label: 'Contacted',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    dot: 'bg-blue-500',
    icon: Phone,
    description: 'Initial contact made',
  },
  qualified: {
    label: 'Qualified',
    color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    dot: 'bg-violet-500',
    icon: CheckCircle,
    description: 'Meets qualification criteria',
  },
  unqualified: {
    label: 'Unqualified',
    color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    dot: 'bg-red-500',
    icon: XCircle,
    description: 'Does not meet criteria',
  },
  converted: {
    label: 'Converted',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    icon: Zap,
    description: 'Became a customer',
  },
  lost: {
    label: 'Lost',
    color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    dot: 'bg-gray-400',
    icon: Archive,
    description: 'Opportunity lost',
  },
};

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialLeads: any[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  companies: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamMembers: any[];
  permissions: Record<string, boolean>;
  totalCount: number;
  tenantId: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _teamMembers?: any[];
  _permissions?: Record<string, boolean>;
  _tenantId?: string;
}

export default function LeadsClient({
  initialLeads,
  companies,
  _teamMembers,
  _permissions,
  totalCount,
  _tenantId,
  userId,
}: Props) {
  const router = useRouter();
  const [leads, setLeads] = useState(initialLeads);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState<string>('all');
  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddData, setQuickAddData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company_id: '',
    lead_source: '',
    tags: '',
  });
  const [addingLead, setAddingLead] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const q = new URLSearchParams({ limit: '100' });
    if (activeStatus !== 'all') q.set('lead_status', activeStatus);
    if (search) q.set('q', search);
    try {
      const res = await fetch('/api/tenant/contacts?' + q, { signal });
      const data = await res.json();
      setLeads(data.data ?? []);
    } catch {
      toast.error('Failed to load leads');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeStatus, search]);

  useEffect(() => { load(); }, [activeStatus, search, load]);

  // Pipeline statistics
  const stats = Object.entries(PIPELINE_CONFIG).map(([id, config]) => {
    const count = leads.filter(l => l.lead_status === id).length;
    return { id, ...config, count };
  });

  const handleExport = async () => {
    setExporting(true);
    const q = new URLSearchParams();
    if (activeStatus !== 'all') q.set('lead_status', activeStatus);
    if (search) q.set('q', search);
    try {
      const res = await fetch('/api/tenant/contacts/export?' + q);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_${activeStatus !== 'all' ? activeStatus + '_' : ''}${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${leads.length} leads`);
    } catch {
      toast.error('Nothing to export');
    } finally {
      setExporting(false);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingLead(true);
    try {
      const tagsArray = quickAddData.tags
        ? quickAddData.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];
      const res = await fetch('/api/tenant/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...quickAddData,
          tags: tagsArray,
          lead_status: 'new',
          assigned_to: userId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Lead added successfully');
      setShowQuickAdd(false);
      setQuickAddData({ first_name: '', last_name: '', email: '', phone: '', company_id: '', lead_source: '', tags: '' });
      load();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err.message || 'Failed to add lead');
    } finally {
      setAddingLead(false);
    }
  };

  const updateLeadStatus = async (leadId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/tenant/contacts/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success('Status updated');
      load();
    } catch {
      toast.error('Failed to update status');
    }
  };

  const deleteLead = async (leadId: string, _name: string) => {
    try {
      const res = await fetch(`/api/tenant/contacts/${leadId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Lead deleted');
      load();
    } catch {
      toast.error('Failed to delete lead');
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedLeads);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    setSelectedLeads(next);
  };

  const bulkUpdateStatus = async (newStatus: string) => {
    if (selectedLeads.size === 0) return;
    try {
      const res = await fetch('/api/tenant/contacts/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedLeads), updates: { lead_status: newStatus } }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Updated ${selectedLeads.size} leads`);
      setSelectedLeads(new Set());
      load();
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shrink-0 shadow-lg shadow-violet-500/20">
            <Target className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Leads Pipeline</h1>
            <p className="text-sm text-muted-foreground">
              Track and manage your sales opportunities
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)} className="shrink-0 min-h-[44px]">
            <Upload className="w-3.5 h-3.5 mr-2" />
            Import
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="shrink-0 min-h-[44px]">
            <Download className="w-3.5 h-3.5 mr-2" />
            {exporting ? 'Exporting...' : 'Export'}
          </Button>
          <Button size="sm" onClick={() => setShowQuickAdd(true)} className="shrink-0 bg-violet-600 hover:bg-violet-700 shadow-md min-h-[44px]">
            <Plus className="w-3.5 h-3.5 mr-2" />
            Add Lead
          </Button>
        </div>
      </div>

      {/* Pipeline Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <button
          onClick={() => setActiveStatus('all')}
          className={cn(
            'p-3 rounded-xl border transition-all text-center',
            activeStatus === 'all'
              ? 'bg-foreground text-background border-transparent shadow-lg'
              : 'bg-card hover:bg-accent border-border'
          )}
        >
          <div className="text-2xl font-bold">{totalCount}</div>
          <div className="text-xs font-medium opacity-70">All Leads</div>
        </button>
        {stats.map(({ id, label, count, dot, color }) => (
          <button
            key={id}
            onClick={() => setActiveStatus(id)}
            className={cn(
              'p-3 rounded-xl border transition-all text-center',
              activeStatus === id
                ? `${color} border-transparent shadow-md`
                : 'bg-card hover:bg-accent border-border'
            )}
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <div className={cn('w-2 h-2 rounded-full', dot)} />
              <div className="text-2xl font-bold">{count}</div>
            </div>
            <div className="text-xs font-medium">{label}</div>
          </button>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or company..."
            className="pl-9"
          />
        </div>
        {selectedLeads.size > 0 && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-accent">
            <span className="text-sm font-medium px-2">
              {selectedLeads.size} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  Move <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {Object.entries(PIPELINE_CONFIG).map(([id, { label }]) => (
                  <DropdownMenuItem
                    key={id}
                    onClick={() => bulkUpdateStatus(id)}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedLeads(new Set())}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Quick Add Modal */}
      {showQuickAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Quick Add Lead</h2>
              <button onClick={() => setShowQuickAdd(false)}>
                <XCircle className="w-5 h-5 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
            <form onSubmit={handleQuickAdd} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="First name *"
                  value={quickAddData.first_name}
                  onChange={(e) =>
                    setQuickAddData({ ...quickAddData, first_name: e.target.value })
                  }
                  required
                />
                <Input
                  placeholder="Last name"
                  value={quickAddData.last_name}
                  onChange={(e) =>
                    setQuickAddData({ ...quickAddData, last_name: e.target.value })
                  }
                />
              </div>
              <Input
                type="email"
                placeholder="Email address *"
                value={quickAddData.email}
                onChange={(e) =>
                  setQuickAddData({ ...quickAddData, email: e.target.value })
                }
                required
              />
              <Input
                type="tel"
                placeholder="Phone"
                value={quickAddData.phone}
                onChange={(e) =>
                  setQuickAddData({ ...quickAddData, phone: e.target.value })
                }
              />
              <select
                value={quickAddData.company_id}
                onChange={(e) =>
                  setQuickAddData({ ...quickAddData, company_id: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg border border-border bg-card"
              >
                <option value="">Select company (optional)</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Lead source (e.g., Website, Referral)"
                value={quickAddData.lead_source}
                onChange={(e) =>
                  setQuickAddData({ ...quickAddData, lead_source: e.target.value })
                }
              />
              <Input
                placeholder="Tags (comma separated)"
                value={quickAddData.tags}
                onChange={(e) =>
                  setQuickAddData({ ...quickAddData, tags: e.target.value })
                }
              />
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setShowQuickAdd(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={addingLead}>
                  {addingLead ? 'Adding...' : 'Add Lead'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Leads Table */}
      <div className="admin-card overflow-hidden">
        <div className="table-responsive">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/20">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedLeads(new Set(leads.map((l) => l.id)));
                    } else {
                      setSelectedLeads(new Set());
                    }
                  }}
                  checked={selectedLeads.size === leads.length && leads.length > 0}
                  className="rounded border-border"
                />
              </th>
              {[
                'Lead',
                'Company',
                'Contact',
                'Status',
                'Source',
                'Score',
                'Added',
                '',
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="text-center py-8">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Loading leads...
                  </div>
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12">
                  <div className="max-w-sm mx-auto">
                    <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                    <p className="text-sm font-medium">
                      No leads {activeStatus !== 'all' ? `with status "${PIPELINE_CONFIG[activeStatus as keyof typeof PIPELINE_CONFIG]?.label}"` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {search ? 'Try adjusting your search' : 'Import a CSV or add leads manually to get started'}
                    </p>
                    {!search && (
                      <Button size="sm" className="mt-4" onClick={() => setShowQuickAdd(true)}>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Your First Lead
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {leads.map((lead) => {
              const statusConfig = PIPELINE_CONFIG[lead.lead_status as keyof typeof PIPELINE_CONFIG] || PIPELINE_CONFIG.new;
              const StatusIcon = statusConfig.icon;

              return (
                  <tr key={lead.id} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedLeads.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      className="rounded border-border"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div
                      className="flex items-center gap-3 cursor-pointer"
                      onClick={() => router.push(`/tenant/contacts/${lead.id}`)}
                    >
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                        {getInitials(`${lead.first_name} ${lead.last_name}`)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {lead.first_name} {lead.last_name}
                        </p>
                        {lead.assigned_name && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {lead.assigned_name}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {lead.company_name ? (
                      <div className="flex items-center gap-1.5 text-sm">
                        <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                        {lead.company_name}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-colors', statusConfig.color)}>
                          <StatusIcon className="w-3 h-3" />
                          {statusConfig.label}
                          <ChevronDown className="w-3 h-3 opacity-50" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {Object.entries(PIPELINE_CONFIG).map(([id, config]) => (
                          <DropdownMenuItem
                            key={id}
                            onClick={() => updateLeadStatus(lead.id, id)}
                          >
                            <config.icon className="w-4 h-4 mr-2" />
                            {config.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                  <td className="px-4 py-3">
                    {lead.lead_source ? (
                      <Badge variant="secondary" className="capitalize">
                        {lead.lead_source}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {lead.score > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span className="text-sm font-medium">{lead.score}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(lead.created_at)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 hover:bg-accent rounded">
                          <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => router.push(`/tenant/contacts/${lead.id}`)}>
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => router.push(`/tenant/contacts/${lead.id}?tab=activities`)}>
                          <Activity className="w-4 h-4 mr-2" />
                          Add Activity
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => deleteLead(lead.id, `${lead.first_name} ${lead.last_name}`)}
                          className="text-red-600"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>

      {showImport && (
        <ImportModal
          onDone={() => {
            setShowImport(false);
            load();
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
