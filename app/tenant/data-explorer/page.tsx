/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { confirmThen } from '@/components/ui/confirm-dialog';
import {
  Search, ChevronLeft, ChevronRight, Download,
  Edit2, Trash2, Loader2, ArrowUpDown, Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { ErrorBoundary } from '@/components/ui/error-boundary';

const ENTITIES = [
  { id: 'contacts', label: 'Contacts', icon: '👤' },
  { id: 'leads', label: 'Leads', icon: '⭐' },
  { id: 'deals', label: 'Deals', icon: '💰' },
  { id: 'companies', label: 'Companies', icon: '🏢' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
] as const;

type EntityType = (typeof ENTITIES)[number]['id'];

interface SearchResult {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  sort: string;
  order: string;
}

const COLUMNS: Record<EntityType, { key: string; label: string; sortable?: boolean }[]> = {
  contacts: [
    { key: 'first_name', label: 'First Name', sortable: true },
    { key: 'last_name', label: 'Last Name', sortable: true },
    { key: 'email', label: 'Email', sortable: true },
    { key: 'phone', label: 'Phone' },
    { key: 'lead_status', label: 'Status' },
    { key: 'company_name', label: 'Company' },
    { key: 'created_at', label: 'Created', sortable: true },
  ],
  leads: [
    { key: 'first_name', label: 'First Name', sortable: true },
    { key: 'last_name', label: 'Last Name', sortable: true },
    { key: 'email', label: 'Email', sortable: true },
    { key: 'phone', label: 'Phone' },
    { key: 'lead_status', label: 'Status' },
    { key: 'score', label: 'Score' },
    { key: 'created_at', label: 'Created', sortable: true },
  ],
  deals: [
    { key: 'title', label: 'Title', sortable: true },
    { key: 'amount', label: 'Amount', sortable: true },
    { key: 'stage_id', label: 'Stage' },
    { key: 'close_date', label: 'Close Date' },
    { key: 'contact_name', label: 'Contact' },
    { key: 'created_at', label: 'Created', sortable: true },
  ],
  companies: [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'industry', label: 'Industry' },
    { key: 'website', label: 'Website' },
    { key: 'phone', label: 'Phone' },
    { key: 'contact_count', label: 'Contacts' },
    { key: 'created_at', label: 'Created', sortable: true },
  ],
  tasks: [
    { key: 'title', label: 'Title', sortable: true },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'due_date', label: 'Due Date' },
    { key: 'created_at', label: 'Created', sortable: true },
  ],
};

// #1075: cross-entity searchable/sortable/inline-editable data table with CSV
// export and per-cell value formatting. Isolate in an error boundary so a
// render fault shows an inline fallback with retry instead of blanking the page.
export default function DataExplorerPage() {
  return (
    <ErrorBoundary>
      <DataExplorerInner />
    </ErrorBoundary>
  );
}

function DataExplorerInner() {
  const [query, setQuery] = useState('');
  const [entityType, setEntityType] = useState<EntityType>('contacts');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [editTarget, setEditTarget] = useState<{ table: string; id: string; field: string; value: unknown } | null>(null);

  const columns = COLUMNS[entityType];

  const handleSearch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: entityType,
        page: String(page),
        limit: '50',
        sort,
        order,
      });
      if (query.trim()) params.set('q', query.trim());

      const res = await fetch(`/api/tenant/data-explorer?${params}`, { signal });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      if (signal?.aborted) return;
      setResults(data);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      toast.error('Search failed');
    } finally {
      if (signal?.aborted) return;
      setLoading(false);
    }
  }, [query, entityType, page, sort, order]);

  useEffect(() => {
    const controller = new AbortController();
    handleSearch(controller.signal);
    return () => controller.abort();
  }, [handleSearch]);

  useEffect(() => {
    setPage(1);
  }, [entityType, query]);

  const handleSort = (key: string) => {
    if (sort === key) {
      setOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(key);
      setOrder('desc');
    }
  };

  const handleEdit = (id: string, field: string, currentValue: unknown) => {
    setEditTarget({ table: entityType, id, field, value: currentValue });
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    try {
      const res = await fetch('/api/tenant/data-explorer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editTarget),
      });
      if (!res.ok) throw new Error('Update failed');
      toast.success('Record updated');
      setEditTarget(null);
      handleSearch();
    } catch {
      toast.error('Failed to update record');
    }
  };

  const handleDelete = async (id: string) => {
    await confirmThen('Delete this record? It will be soft-deleted.', async () => {
      try {
        const res = await fetch('/api/tenant/data-explorer', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ table: entityType, id }),
        });
        if (!res.ok) throw new Error('Delete failed');
        toast.success('Record deleted');
        handleSearch();
      } catch {
        toast.error('Failed to delete record');
      }
    });
  };

  const exportToCSV = () => {
    if (!results?.data.length) {
      toast.error('No data to export');
      return;
    }

    const headers = columns.map(c => c.label);
    const rows = results.data.map(row =>
      columns.map(c => {
        const val = row[c.key];
        const str = val == null ? '' : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      })
    );

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data-explorer-${entityType}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = results ? Math.ceil(results.total / results.limit) : 1;

  return (
    <div className="space-y-4 sm:space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold">Data Explorer</h1>
            <p className="text-sm text-muted-foreground">Search and browse your data</p>
          </div>
        </div>
      </div>

      {/* Entity tabs */}
      <div className="flex flex-wrap gap-2">
        {ENTITIES.map(e => (
          <button
            key={e.id}
            onClick={() => setEntityType(e.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors',
              entityType === e.id
                ? 'bg-violet-600 text-white border-violet-600'
                : 'border-border hover:bg-accent'
            )}
          >
            <span>{e.icon}</span> {e.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${entityType}...`}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:border-violet-500 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
            >
              Clear
            </button>
          )}
        </div>
        <button
          onClick={() => handleSearch()}
          disabled={loading}
          className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Search
        </button>
        {results && results.data.length > 0 && (
          <button
            onClick={exportToCSV}
            className="px-4 py-2 border border-border rounded-xl text-sm hover:bg-accent transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        )}
      </div>

      {/* Results count */}
      {results && (
        <p className="text-xs text-muted-foreground">
          {results.total} result{results.total !== 1 ? 's' : ''}
          {results.total > results.limit && ` (showing page ${results.page} of ${Math.ceil(results.total / results.limit)})`}
        </p>
      )}

      {/* Results table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !results || results.data.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Database className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No {entityType} found</p>
            <p className="text-xs mt-1">Try a different search or entity type</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {columns.map(col => (
                    <th
                      key={col.key}
                      className={cn(
                        'px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider',
                        col.sortable && 'cursor-pointer hover:text-foreground select-none'
                      )}
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        {col.sortable && sort === col.key && (
                          <ArrowUpDown className={cn('w-3 h-3', order === 'asc' && 'rotate-180')} />
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.data.map((row, i) => (
                  <tr key={String(row.id ?? i)} className="hover:bg-muted/30 transition-colors">
                    {columns.map(col => (
                      <td key={col.key} className="px-4 py-3 text-sm truncate max-w-[200px]">
                        {editTarget?.id === row.id && editTarget?.field === col.key ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              defaultValue={String(row[col.key] ?? '')}
                              autoFocus
                              className="w-full px-2 py-1 text-xs border border-border rounded bg-card"
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  setEditTarget({ ...editTarget, value: (e.target as HTMLInputElement).value });
                                  handleSaveEdit();
                                }
                                if (e.key === 'Escape') setEditTarget(null);
                              }}
                              onBlur={e => {
                                setEditTarget({ ...editTarget, value: e.target.value });
                                handleSaveEdit();
                              }}
                            />
                          </div>
                        ) : (
                          <span className="text-xs">
                            {formatCellValue(row[col.key])}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleEdit(String(row.id), columns[0]?.key ?? 'id', row[columns[0]?.key ?? 'id'])}
                          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(String(row.id))}
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-600 transition-colors"
                          title="Delete"
                        >
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
      </div>

      {/* Pagination */}
      {results && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-2 rounded-lg border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 3, totalPages - 6));
            const p = start + i;
            if (p > totalPages) return null;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  'w-8 h-8 rounded-lg text-xs font-medium transition-colors',
                  p === page
                    ? 'bg-violet-600 text-white'
                    : 'border border-border hover:bg-accent'
                )}
              >
                {p}
              </button>
            );
          })}
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-2 rounded-lg border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function formatCellValue(val: unknown): string {
  if (val == null) return '-';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (val instanceof Date || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val))) {
    try {
      return new Date(val).toLocaleDateString();
    } catch {
      return String(val);
    }
  }
  return String(val);
}
