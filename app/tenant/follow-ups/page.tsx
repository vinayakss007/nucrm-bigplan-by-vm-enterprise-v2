/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ListChecks, Calendar, AlertCircle, Plus, CheckCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface FollowUp {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  status: string;
  missedDays: number | null;
  autoAiEnabled: boolean | null;
  completedAt: string | null;
  contactName: string | null;
  leadName: string | null;
  assigneeName: string | null;
}

export default function FollowUpsPage() {
  const [data, setData] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', description: '', dueDate: '', contact_id: '', lead_id: '', deal_id: '' });
  const [saving, setSaving] = useState(false);
  const limit = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`/api/tenant/follow-ups?${params}`);
      if (!res.ok) throw new Error('Failed to fetch follow-ups');
      const json = await res.json();
      setData(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load follow-ups';
      setError(message);
      toast.error('Failed to load follow-ups');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => { setOffset(0); }, [statusFilter]);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  async function handleCreate() {
    if (!createForm.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createForm.title,
          description: createForm.description || undefined,
          due_date: createForm.dueDate || undefined,
          contact_id: createForm.contact_id || undefined,
          lead_id: createForm.lead_id || undefined,
          deal_id: createForm.deal_id || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to create');
      toast.success('Follow-up created');
      setShowCreate(false);
      setCreateForm({ title: '', description: '', dueDate: '', contact_id: '', lead_id: '', deal_id: '' });
      setOffset(0);
      fetchData();
    } catch {
      toast.error('Failed to create follow-up');
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(id: string) {
    try {
      const res = await fetch(`/api/tenant/follow-ups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Marked as complete');
      fetchData();
    } catch {
      toast.error('Failed to complete follow-up');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this follow-up?')) return;
    try {
      const res = await fetch(`/api/tenant/follow-ups/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Follow-up deleted');
      fetchData();
    } catch {
      toast.error('Failed to delete follow-up');
    }
  }

  const statusColors: Record<string, string> = {
    pending: 'text-amber-600 bg-amber-50 dark:bg-amber-950/20',
    completed: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20',
    missed: 'text-red-600 bg-red-50 dark:bg-red-950/20',
    cancelled: 'text-muted-foreground bg-muted',
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ListChecks className="w-5 h-5" /> Follow-Ups
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your follow-up tasks</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Follow-up
          </button>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-border bg-background text-sm"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="missed">Missed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Link
            href="/tenant/follow-ups/missed"
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 dark:bg-red-950/20 text-red-600 text-sm font-medium hover:bg-red-100 dark:hover:bg-red-950/40 transition-colors"
          >
            <AlertCircle className="w-4 h-4" /> Missed
          </Link>
        </div>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="admin-card p-4 animate-pulse">
              <div className="skeleton-shimmer h-4 w-48 rounded mb-2" />
              <div className="skeleton-shimmer h-3 w-32 rounded" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="admin-card p-8 text-center">
          <ListChecks className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No follow-ups found</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {statusFilter ? 'Try changing the status filter' : 'Create a follow-up from a contact or deal'}
          </p>
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <>
          <div className="space-y-2">
            {data.map((fu) => (
              <div key={fu.id} className="admin-card p-4 hover:border-violet-200 dark:hover:border-violet-800 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{fu.title}</p>
                    {fu.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{fu.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/70">
                      {fu.dueDate && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(fu.dueDate).toLocaleDateString()}
                        </span>
                      )}
                      {fu.contactName && <span>{fu.contactName}</span>}
                      {fu.leadName && <span>{fu.leadName}</span>}
                      {fu.assigneeName && <span>Assigned to {fu.assigneeName}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {fu.status !== 'completed' && (
                      <button
                        onClick={() => handleComplete(fu.id)}
                        className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-950/20 text-green-600 transition-colors"
                        title="Mark complete"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(fu.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-red-600 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <span className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-medium capitalize',
                      statusColors[fu.status] ?? 'bg-muted text-muted-foreground'
                    )}>
                      {fu.status}
                    </span>
                    {fu.status !== 'completed' && (
                      <button
                        onClick={async () => {
                          const res = await fetch(`/api/tenant/follow-ups?id=${fu.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
                          if (res.ok) { toast.success('Marked complete'); fetchData(); } else { toast.error('Failed'); }
                        }}
                        className="text-xs px-2 py-1 rounded border border-border hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:text-emerald-700 transition-colors"
                      >
                        Complete
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        const res = await fetch(`/api/tenant/follow-ups?id=${fu.id}`, { method: 'DELETE' });
                        if (res.ok) { toast.success('Deleted'); fetchData(); } else { toast.error('Failed'); }
                      }}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-700 text-muted-foreground transition-colors"
                    >
                      Delete
                    </button>
                    {fu.missedDays != null && fu.missedDays > 0 && (
                      <span className="text-xs text-red-500 font-medium whitespace-nowrap">
                        {fu.missedDays}d overdue
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-muted-foreground">
                Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Previous
                </button>
                <span className="text-xs text-muted-foreground px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Follow-up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Title *</label>
              <input
                value={createForm.title}
                onChange={(e) => setCreateForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Follow up on proposal"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Description</label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional details"
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Due Date</label>
              <input
                type="date"
                value={createForm.dueDate}
                onChange={(e) => setCreateForm(f => ({ ...f, dueDate: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Contact ID (optional)</label>
              <input
                value={createForm.contact_id}
                onChange={(e) => setCreateForm(f => ({ ...f, contact_id: e.target.value }))}
                placeholder="Contact UUID"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Lead ID (optional)</label>
              <input
                value={createForm.lead_id}
                onChange={(e) => setCreateForm(f => ({ ...f, lead_id: e.target.value }))}
                placeholder="Lead UUID"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground block mb-1">Deal ID (optional)</label>
              <input
                value={createForm.deal_id}
                onChange={(e) => setCreateForm(f => ({ ...f, deal_id: e.target.value }))}
                placeholder="Deal UUID"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-background hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !createForm.title.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
