'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Calendar, User, Building2, TrendingUp, CheckCircle,
  Edit, Trash2, Clock, AlertTriangle, FileText, MoreHorizontal,
  Target
} from 'lucide-react';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import toast from 'react-hot-toast';

const PRIORITY_CFG: Record<string, { label: string; color: string; dot: string }> = {
  high: { label: 'High', color: 'text-red-600', dot: 'bg-red-500' },
  medium: { label: 'Medium', color: 'text-amber-600', dot: 'bg-amber-500' },
  low: { label: 'Low', color: 'text-slate-500', dot: 'bg-slate-400' },
};

const STATUS_CFG: Record<string, { label: string; bg: string }> = {
  pending: { label: 'Pending', bg: 'bg-slate-100 text-slate-600' },
  in_progress: { label: 'In Progress', bg: 'bg-blue-100 text-blue-600' },
  completed: { label: 'Completed', bg: 'bg-emerald-100 text-emerald-600' },
  cancelled: { label: 'Cancelled', bg: 'bg-red-100 text-red-600' },
};

interface Props {
  task: any;
  permissions: { canEdit: boolean; canDelete: boolean; canAssign: boolean };
  tenantId: string;
  userId: string;
}

export default function TaskDetailClient({ task, permissions, tenantId, userId }: Props) {
  const router = useRouter();
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    title: task.title || '',
    description: task.description || '',
    priority: task.priority || 'medium',
    status: task.status || 'pending',
    due_date: task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : '',
    assigned_to: task.assigned_to || '',
  });

  const today = new Date().toISOString().split('T')[0] || '';
  const isOverdue = !task.completed && task.due_date && task.due_date < today;
  const pCfg = PRIORITY_CFG[task.priority] || { label: task.priority || 'Medium', color: 'text-slate-500', dot: 'bg-slate-400' };
  const sCfg = STATUS_CFG[task.status] || { label: task.status || 'Pending', bg: 'bg-slate-100 text-slate-600' };

  const toggleComplete = async () => {
    try {
      const res = await fetch(`/api/tenant/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !task.completed }),
      });
      if (!res.ok) { toast.error('Failed to update'); return; }
      toast.success(task.completed ? 'Task reopened' : 'Task completed!');
      router.refresh();
    } catch { toast.error('Failed to update'); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tenant/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) { const d = await res.json(); toast.error(d.error || 'Failed'); return; }
      toast.success('Task updated');
      setShowEdit(false);
      router.refresh();
    } catch { toast.error('Failed to update'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/tenant/tasks/${task.id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Failed to delete'); return; }
      toast.success('Task deleted');
      router.push('/tenant/tasks');
    } catch { toast.error('Failed to delete'); }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
  const lbl = "block text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide";

  return (
    <div className="max-w-4xl space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/tenant/tasks" className="p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shrink-0',
            task.completed
              ? 'bg-gradient-to-br from-emerald-500 to-green-500'
              : isOverdue ? 'bg-gradient-to-br from-red-500 to-orange-500' : 'bg-gradient-to-br from-violet-500 to-indigo-500'
          )}>
            {task.completed ? <CheckCircle className="w-7 h-7" /> : <FileText className="w-7 h-7" />}
          </div>
          <div>
            <h1 className={cn('text-xl font-bold', task.completed && 'line-through text-muted-foreground')}>
              {task.title}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={cn('text-xs font-semibold', sCfg.bg)}>
                {sCfg.label}
              </Badge>
              <span className={cn('text-xs font-semibold flex items-center gap-1', pCfg.color)}>
                <div className={cn('w-1.5 h-1.5 rounded-full', pCfg.dot)} />
                {pCfg.label} Priority
              </span>
              {isOverdue && (
                <span className="text-xs font-semibold text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Overdue
                </span>
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
            <DropdownMenuItem onClick={toggleComplete}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Mark {task.completed ? 'Incomplete' : 'Complete'}
            </DropdownMenuItem>
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
          <Calendar className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-lg font-bold">{task.due_date ? formatDate(task.due_date) : '—'}</p>
          <p className="text-xs text-muted-foreground">Due Date</p>
        </div>
        <div className="admin-card p-4 text-center">
          <Clock className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-lg font-bold">{formatRelativeTime(task.created_at)}</p>
          <p className="text-xs text-muted-foreground">Created</p>
        </div>
        <div className="admin-card p-4 text-center">
          <User className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-lg font-bold">{task.assigned_name || 'Unassigned'}</p>
          <p className="text-xs text-muted-foreground">Assigned To</p>
        </div>
        <div className="admin-card p-4 text-center">
          <CheckCircle className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
          <p className="text-lg font-bold">{task.completed ? '✓ Done' : 'Pending'}</p>
          <p className="text-xs text-muted-foreground">Status</p>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Task Info */}
        <div className="space-y-4">
          <div className="admin-card p-5 space-y-3">
            <h2 className="text-sm font-semibold">Task Details</h2>
            {task.contact_id && (
              <Link href={`/tenant/contacts/${task.contact_id}`}
                className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-violet-600 transition-colors">
                <User className="w-4 h-4 shrink-0" />
                {task.first_name} {task.last_name}
              </Link>
            )}
            {task.deal_id && (
              <Link href={`/tenant/deals/${task.deal_id}`}
                className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-violet-600 transition-colors">
                <TrendingUp className="w-4 h-4 shrink-0" />
                {task.deal_title}
              </Link>
            )}
            {task.company_id && (
              <Link href={`/tenant/companies/${task.company_id}`}
                className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-violet-600 transition-colors">
                <Building2 className="w-4 h-4 shrink-0" />
                {task.company_name}
              </Link>
            )}
            {task.assigned_name && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <Target className="w-4 h-4 shrink-0" />
                {task.assigned_name}
              </div>
            )}
            <div className="pt-2 border-t border-border text-xs text-muted-foreground space-y-1.5">
              <div className="flex justify-between">
                <span>Created</span>
                <span className="font-medium text-foreground">{formatRelativeTime(task.created_at)}</span>
              </div>
              {task.completed_at && (
                <div className="flex justify-between">
                  <span>Completed</span>
                  <span className="font-medium text-emerald-600">{formatRelativeTime(task.completed_at)}</span>
                </div>
              )}
            </div>
          </div>
          {task.description && (
            <div className="admin-card p-5 space-y-2">
              <h2 className="text-sm font-semibold">Description</h2>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
            </div>
          )}
        </div>

        {/* Related Info Placeholder */}
        <div className="lg:col-span-2 space-y-4">
          <div className="admin-card p-8 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm font-semibold text-muted-foreground">Task Details</p>
            <p className="text-xs text-muted-foreground mt-1">
              {task.due_date && `Due: ${formatDate(task.due_date)}`}
            </p>
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className={lbl}>Title *</label>
              <input className={inp} value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} required />
            </div>
            <div>
              <label className={lbl}>Description</label>
              <textarea className={inp} rows={3} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={lbl}>Priority</label>
                <select className={inp} value={editForm.priority} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Status</label>
                <select className={inp} value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Due Date</label>
                <input type="date" className={inp} value={editForm.due_date} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
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
          <DialogHeader><DialogTitle>Delete Task</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{task.title}</strong>?
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
