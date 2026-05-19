'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, DollarSign, Calendar, User, Building2, TrendingUp,
  Edit, Trash2, Clock, CheckCircle, AlertTriangle, Activity,
  FileText, Plus, MoreHorizontal
} from 'lucide-react';
import { cn, formatDate, formatCurrency, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import toast from 'react-hot-toast';

const STAGES = [
  { id: 'lead', label: 'Lead', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  { id: 'qualified', label: 'Qualified', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { id: 'proposal', label: 'Proposal', color: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  { id: 'negotiation', label: 'Negotiation', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  { id: 'won', label: 'Won', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { id: 'lost', label: 'Lost', color: 'bg-red-100 text-red-600', dot: 'bg-red-500' },
];

const PRIORITY_CFG: Record<string, { label: string; color: string }> = {
  high: { label: 'High', color: 'text-red-600' },
  medium: { label: 'Medium', color: 'text-amber-600' },
  low: { label: 'Low', color: 'text-slate-500' },
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-600' },
  completed: { label: 'Completed', color: 'bg-emerald-100 text-emerald-600' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-600' },
};

interface Props {
  deal: any;
  tasks: any[];
  activities: any[];
  permissions: { canEdit: boolean; canDelete: boolean; canViewValue: boolean };
  tenantId: string;
  userId: string;
}

export default function DealDetailClient({ deal, tasks, activities, permissions, tenantId, userId }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'activities'>('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [editForm, setEditForm] = useState({
    title: deal.title || '',
    value: deal.value?.toString() || '0',
    stage: deal.stage || 'lead',
    probability: deal.probability?.toString() || '10',
    close_date: deal.close_date ? new Date(deal.close_date).toISOString().split('T')[0] : '',
    description: deal.description || deal.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const stage = STAGES.find(s => s.id === deal.stage) || STAGES[0]!;
  const stageColor = stage?.color || 'bg-slate-100 text-slate-700';
  const stageDot = stage?.dot || 'bg-slate-400';
  const stageLabel = stage?.label || deal.stage;

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/deals/${deal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editForm,
          value: Number(editForm.value) || 0,
          probability: Number(editForm.probability) || 10,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to update');
        return;
      }
      toast.success('Deal updated');
      setShowEdit(false);
      router.refresh();
    } catch {
      toast.error('Failed to update deal');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/tenant/deals/${deal.id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Failed to delete deal');
        return;
      }
      toast.success('Deal deleted');
      router.push('/tenant/deals');
    } catch {
      toast.error('Failed to delete deal');
    }
  };

  const toggleTaskComplete = async (taskId: string, completed: boolean) => {
    try {
      await fetch(`/api/tenant/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      router.refresh();
    } catch {
      toast.error('Failed to update task');
    }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
  const lbl = "block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide";

  return (
    <div className="max-w-5xl space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/tenant/deals" className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-xl font-bold shrink-0">
            <DollarSign className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{deal.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={cn('text-xs font-semibold', stageColor)}>
                <div className={cn('w-1.5 h-1.5 rounded-full mr-1.5', stageDot)} />
                {stageLabel}
              </Badge>
              {permissions.canViewValue && (
                <span className="text-sm font-bold text-violet-600">{formatCurrency(Number(deal.value))}</span>
              )}
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {permissions.canEdit && (
              <DropdownMenuItem onClick={() => setShowEdit(true)}>
                <Edit className="mr-2 h-4 w-4" /> Edit
              </DropdownMenuItem>
            )}
            {permissions.canDelete && (
              <DropdownMenuItem className="text-red-600" onClick={() => setShowDelete(true)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="admin-card p-4 text-center">
          <DollarSign className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xl font-bold">{permissions.canViewValue ? formatCurrency(Number(deal.value)) : '—'}</p>
          <p className="text-xs text-muted-foreground">Value</p>
        </div>
        <div className="admin-card p-4 text-center">
          <TrendingUp className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xl font-bold">{deal.probability || 0}%</p>
          <p className="text-xs text-muted-foreground">Probability</p>
        </div>
        <div className="admin-card p-4 text-center">
          <Calendar className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xl font-bold">{deal.close_date ? formatDate(deal.close_date) : '—'}</p>
          <p className="text-xs text-muted-foreground">Close Date</p>
        </div>
        <div className="admin-card p-4 text-center">
          <FileText className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-xl font-bold">{tasks.length}</p>
          <p className="text-xs text-muted-foreground">Tasks</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['overview', 'tasks', 'activities'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize',
              activeTab === tab
                ? 'border-violet-500 text-violet-600'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab} {tab === 'tasks' && `(${tasks.length})`}
            {tab === 'activities' && `(${activities.length})`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Deal Info */}
          <div className="space-y-4">
            <div className="admin-card p-5 space-y-3">
              <h2 className="text-sm font-semibold">Deal Details</h2>
              {deal.contact_id && (
                <Link href={`/tenant/contacts/${deal.contact_id}`}
                  className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-violet-600 transition-colors">
                  <User className="w-4 h-4 shrink-0" />
                  {deal.first_name} {deal.last_name}
                </Link>
              )}
              {deal.company_id && (
                <Link href={`/tenant/companies/${deal.company_id}`}
                  className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-violet-600 transition-colors">
                  <Building2 className="w-4 h-4 shrink-0" />
                  {deal.company_name}
                </Link>
              )}
              {deal.assigned_name && (
                <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <User className="w-4 h-4 shrink-0" />
                  {deal.assigned_name}
                </div>
              )}
              <div className="pt-2 border-t border-border text-xs text-muted-foreground space-y-1.5">
                <div className="flex justify-between">
                  <span>Created</span>
                  <span className="font-medium text-foreground">{formatRelativeTime(deal.created_at)}</span>
                </div>
              </div>
            </div>
            {(deal.description || deal.notes) && (
              <div className="admin-card p-5 space-y-2">
                <h2 className="text-sm font-semibold">Notes</h2>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{deal.description || deal.notes}</p>
              </div>
            )}
          </div>

          {/* Related Tasks */}
          <div className="lg:col-span-2 space-y-4">
            <div className="admin-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex items-center justify-between">
                <h2 className="text-sm font-semibold">Tasks</h2>
                <Link href={`/tenant/tasks?deal=${deal.id}`} className="text-xs text-violet-600 hover:underline">
                  <Plus className="w-3 h-3 inline mr-1" /> Add task
                </Link>
              </div>
              {!tasks.length ? (
                <p className="px-5 py-6 text-sm text-muted-foreground text-center">No tasks yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {tasks.map(t => {
                    const pCfg = PRIORITY_CFG[t.priority] || { label: t.priority || 'Medium', color: 'text-slate-500' };
                    const sCfg = STATUS_CFG[t.status] || { label: t.status || 'Pending', color: 'bg-slate-100 text-slate-600' };
                    return (
                      <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                        <input
                          type="checkbox"
                          checked={t.completed}
                          onChange={() => toggleTaskComplete(t.id, !t.completed)}
                          className="w-4 h-4 rounded border-border"
                        />
                        <div className="flex-1 min-w-0">
                          <p className={cn('text-sm font-medium truncate', t.completed && 'line-through text-muted-foreground')}>
                            {t.title}
                          </p>
                          {t.due_date && (
                            <p className="text-xs text-muted-foreground">
                              Due: {formatDate(t.due_date)}
                            </p>
                          )}
                        </div>
                        <Badge className={cn('text-[10px] font-semibold', sCfg.color)}>{sCfg.label}</Badge>
                        <span className={cn('text-xs font-semibold', pCfg.color)}>{pCfg.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="admin-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-semibold">All Tasks ({tasks.length})</h2>
            <Link href={`/tenant/tasks?deal=${deal.id}`} className="text-xs text-violet-600 hover:underline">
              <Plus className="w-3 h-3 inline mr-1" /> Add task
            </Link>
          </div>
          {!tasks.length ? (
            <p className="px-5 py-6 text-sm text-muted-foreground text-center">No tasks</p>
          ) : (
            <div className="divide-y divide-border">
              {tasks.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <input
                    type="checkbox"
                    checked={t.completed}
                    onChange={() => toggleTaskComplete(t.id, !t.completed)}
                    className="w-4 h-4 rounded border-border"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-medium', t.completed && 'line-through text-muted-foreground')}>
                      {t.title}
                    </p>
                    {t.description && <p className="text-xs text-muted-foreground truncate">{t.description}</p>}
                  </div>
                  <Badge className={cn('text-xs', (STATUS_CFG[t.status] || { color: 'bg-slate-100 text-slate-600' }).color)}>
                    {(STATUS_CFG[t.status] || { label: 'Unknown' }).label}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'activities' && (
        <div className="admin-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Activity Log ({activities.length})</h2>
          </div>
          {!activities.length ? (
            <p className="px-5 py-6 text-sm text-muted-foreground text-center">No activities yet</p>
          ) : (
            <div className="divide-y divide-border">
              {activities.map(a => (
                <div key={a.id} className="flex items-start gap-3 px-5 py-3">
                  <Activity className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{a.description || a.type || a.action}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.performed_by_name && `${a.performed_by_name} · `}
                      {formatRelativeTime(a.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Deal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className={lbl}>Title *</label>
              <input className={inp} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Value</label>
                <input type="number" className={inp} value={editForm.value} onChange={e => setEditForm(f => ({ ...f, value: e.target.value }))} />
              </div>
              <div>
                <label className={lbl}>Probability %</label>
                <input type="number" className={inp} value={editForm.probability} onChange={e => setEditForm(f => ({ ...f, probability: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Stage</label>
                <select className={inp} value={editForm.stage} onChange={e => setEditForm(f => ({ ...f, stage: e.target.value }))}>
                  {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Close Date</label>
                <input type="date" className={inp} value={editForm.close_date} onChange={e => setEditForm(f => ({ ...f, close_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className={lbl}>Description</label>
              <textarea className={inp} rows={3} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Deal</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{deal.title}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
