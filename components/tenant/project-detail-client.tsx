'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Calendar, User, Plus, Trash2, Link2, Unlink,
  CheckCircle2, Circle, Target,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';

const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  'on-hold': { label: 'On Hold', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  completed: { label: 'Completed', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
};

const TASK_STATUS_CFG: Record<string, { label: string; badge: string }> = {
  pending: { label: 'Pending', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  in_progress: { label: 'In Progress', badge: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
  completed: { label: 'Completed', badge: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' },
  cancelled: { label: 'Cancelled', badge: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

const PRIORITY_CFG: Record<string, { label: string; badge: string }> = {
  high: { label: 'High', badge: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
  medium: { label: 'Medium', badge: 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' },
  low: { label: 'Low', badge: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  created_at: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  updated_at: any;
}

interface Milestone {
  id: string;
  title: string;
  due_date: string | null;
  completed: boolean;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  completed_at: any;
}

interface LinkedTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_name: string | null;
}

interface AvailableTask {
  id: string;
  title: string;
  status: string;
}

interface Props {
  project: ProjectData;
  milestones: Milestone[];
  linkedTasks: LinkedTask[];
  allTasks: AvailableTask[];
  teamMembers: { user_id: string; full_name: string }[];
  permissions: { canEdit: boolean; canDelete: boolean };
  _teamMembers?: { user_id: string; full_name: string }[];
}

export default function ProjectDetailClient({
  project,
  milestones: initialMilestones,
  linkedTasks: initialLinkedTasks,
  allTasks,
  _teamMembers,
  permissions,
}: Props) {
  const router = useRouter();
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>(initialLinkedTasks);
  const [description, setDescription] = useState(project.description || '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);

  // Milestone add form
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDueDate, setMilestoneDueDate] = useState('');
  const [savingMilestone, setSavingMilestone] = useState(false);

  // Link task
  const [showLinkTask, setShowLinkTask] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [linkingTask, setLinkingTask] = useState(false);

  const taskCount = linkedTasks.length;
  const completedCount = linkedTasks.filter(t => t.status === 'completed').length;
  const progressPct = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;

  const statusCfg = STATUS_CFG[project.status] ?? { label: 'Active', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };

  // ---- Status change ----
  const changeStatus = async (newStatus: string) => {
    const res = await fetch(`/api/tenant/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      toast.success('Status updated');
      router.refresh();
    } else {
      toast.error('Failed to update status');
    }
  };

  // ---- Description ----
  const saveDescription = async () => {
    setSavingDesc(true);
    const res = await fetch(`/api/tenant/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    if (res.ok) {
      toast.success('Description saved');
      setEditingDesc(false);
    } else {
      toast.error('Failed to save');
    }
    setSavingDesc(false);
  };

  // ---- Milestones ----
  const addMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!milestoneTitle.trim()) return;
    setSavingMilestone(true);
    const res = await fetch(`/api/tenant/projects/${project.id}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: milestoneTitle.trim(),
        due_date: milestoneDueDate || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMilestones(prev => [...prev, {
        id: data.data.id,
        title: data.data.title,
        due_date: data.data.dueDate,
        completed: data.data.completed ?? false,
        completed_at: data.data.completedAt,
      }]);
      setMilestoneTitle('');
      setMilestoneDueDate('');
      setShowMilestoneForm(false);
      toast.success('Milestone added');
    } else {
      toast.error(data.error || 'Failed to add milestone');
    }
    setSavingMilestone(false);
  };

  const toggleMilestone = async (milestone: Milestone) => {
    const newCompleted = !milestone.completed;
    setMilestones(prev => prev.map(m =>
      m.id === milestone.id ? { ...m, completed: newCompleted } : m
    ));
    const res = await fetch(`/api/tenant/projects/${project.id}/milestones`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone_id: milestone.id, completed: newCompleted }),
    });
    if (!res.ok) {
      setMilestones(prev => prev.map(m =>
        m.id === milestone.id ? { ...m, completed: !newCompleted } : m
      ));
      toast.error('Failed to update milestone');
    }
  };

  const deleteMilestone = async (milestone: Milestone) => {
    const res = await fetch(`/api/tenant/projects/${project.id}/milestones`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ milestone_id: milestone.id }),
    });
    if (res.ok) {
      setMilestones(prev => prev.filter(m => m.id !== milestone.id));
      toast.success('Milestone removed');
    } else {
      toast.error('Failed to delete milestone');
    }
  };

  // ---- Link/unlink tasks ----
  const linkTask = async (taskId: string) => {
    setLinkingTask(true);
    const res = await fetch(`/api/tenant/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId }),
    });
    if (res.ok) {
      const task = allTasks.find(t => t.id === taskId);
      if (task) {
        setLinkedTasks(prev => [...prev, {
          id: task.id,
          title: task.title,
          status: task.status,
          priority: 'medium',
          due_date: null,
          assignee_name: null,
        }]);
      }
      toast.success('Task linked');
      setShowLinkTask(false);
      setTaskSearch('');
    } else {
      const data = await res.json();
      toast.error(data.error || 'Failed to link task');
    }
    setLinkingTask(false);
  };

  const unlinkTask = async (taskId: string) => {
    const res = await fetch(`/api/tenant/projects/${project.id}/tasks?task_id=${taskId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setLinkedTasks(prev => prev.filter(t => t.id !== taskId));
      toast.success('Task unlinked');
    } else {
      toast.error('Failed to unlink task');
    }
  };

  // Filter available tasks (exclude already linked)
  const linkedIds = new Set(linkedTasks.map(t => t.id));
  const availableTasks = allTasks.filter(t =>
    !linkedIds.has(t.id) &&
    (taskSearch === '' || t.title.toLowerCase().includes(taskSearch.toLowerCase()))
  );

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back link */}
      <Link
        href="/tenant/projects"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className={cn('text-xs font-semibold', statusCfg.badge)}>
                {statusCfg.label}
              </Badge>
              {permissions.canEdit && (
                <select
                  className="text-xs border border-border rounded px-2 py-1 bg-transparent"
                  value={project.status}
                  onChange={(e) => changeStatus(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="on-hold">On Hold</option>
                  <option value="completed">Completed</option>
                </select>
              )}
              {project.owner_name && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <User className="w-3.5 h-3.5" />
                  {project.owner_name}
                </span>
              )}
              {(project.start_date || project.end_date) && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Calendar className="w-3.5 h-3.5" />
                  {project.start_date ? formatDate(project.start_date) : '?'}
                  {' - '}
                  {project.end_date ? formatDate(project.end_date) : '?'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {completedCount} of {taskCount} tasks completed
            </span>
            <span className="text-sm text-muted-foreground">{progressPct}%</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                progressPct === 100 ? 'bg-emerald-500' : 'bg-violet-500'
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Description</h2>
          {permissions.canEdit && !editingDesc && (
            <Button variant="ghost" size="sm" onClick={() => setEditingDesc(true)}>
              Edit
            </Button>
          )}
        </div>
        {editingDesc ? (
          <div className="space-y-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inp}
              rows={4}
              placeholder="Add a project description..."
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setEditingDesc(false); setDescription(project.description || ''); }}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveDescription} disabled={savingDesc}>
                {savingDesc ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {description || 'No description provided.'}
          </p>
        )}
      </div>

      {/* Milestones */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Target className="w-4 h-4" />
            Milestones
            <span className="text-xs text-muted-foreground font-normal">({milestones.length})</span>
          </h2>
          {permissions.canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowMilestoneForm(!showMilestoneForm)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Add
            </Button>
          )}
        </div>

        {showMilestoneForm && (
          <form onSubmit={addMilestone} className="flex items-end gap-2 mb-4 p-3 rounded-lg bg-muted/50 border border-border">
            <div className="flex-1">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title</label>
              <input
                value={milestoneTitle}
                onChange={(e) => setMilestoneTitle(e.target.value)}
                placeholder="Milestone title"
                required
                className={inp}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date</label>
              <input
                type="date"
                value={milestoneDueDate}
                onChange={(e) => setMilestoneDueDate(e.target.value)}
                className={inp}
              />
            </div>
            <Button type="submit" size="sm" disabled={savingMilestone}>
              {savingMilestone ? '...' : 'Add'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowMilestoneForm(false)}>
              Cancel
            </Button>
          </form>
        )}

        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones yet.</p>
        ) : (
          <div className="space-y-2">
            {milestones.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                <button
                  onClick={() => permissions.canEdit && toggleMilestone(m)}
                  className={cn(
                    'shrink-0',
                    !permissions.canEdit && 'cursor-default'
                  )}
                  disabled={!permissions.canEdit}
                >
                  {m.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>
                <span className={cn('flex-1 text-sm', m.completed && 'line-through text-muted-foreground')}>
                  {m.title}
                </span>
                {m.due_date && (
                  <span className="text-xs text-muted-foreground">{formatDate(m.due_date)}</span>
                )}
                {permissions.canEdit && (
                  <button
                    onClick={() => deleteMilestone(m)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Linked Tasks */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Linked Tasks
            <span className="text-xs text-muted-foreground font-normal">({linkedTasks.length})</span>
          </h2>
          {permissions.canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLinkTask(!showLinkTask)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Link Task
            </Button>
          )}
        </div>

        {showLinkTask && (
          <div className="mb-4 p-3 rounded-lg bg-muted/50 border border-border space-y-2">
            <input
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              placeholder="Search tasks..."
              className={inp}
            />
            <div className="max-h-40 overflow-y-auto space-y-1">
              {availableTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No matching tasks found.</p>
              ) : (
                availableTasks.slice(0, 20).map((task) => {
                  const tsCfg = TASK_STATUS_CFG[task.status] ?? { label: 'Pending', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' };
                  return (
                    <button
                      key={task.id}
                      onClick={() => linkTask(task.id)}
                      disabled={linkingTask}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted text-sm flex items-center justify-between transition-colors"
                    >
                      <span className="truncate">{task.title}</span>
                      <Badge className={cn('text-[10px]', tsCfg.badge)}>
                        {tsCfg.label}
                      </Badge>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {linkedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks linked to this project.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Title</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Priority</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Assignee</th>
                  {permissions.canEdit && (
                    <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {linkedTasks.map((task) => {
                  const sCfg = TASK_STATUS_CFG[task.status] ?? { label: 'Pending', badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' };
                  const pCfg = PRIORITY_CFG[task.priority] ?? { label: 'Medium', badge: 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' };
                  return (
                    <tr key={task.id} className="hover:bg-muted/50 transition-colors">
                      <td className="py-2 px-3">
                        <Link
                          href={`/tenant/tasks/${task.id}`}
                          className="font-medium hover:text-violet-600 transition-colors"
                        >
                          {task.title}
                        </Link>
                      </td>
                      <td className="py-2 px-3">
                        <Badge className={cn('text-[10px]', sCfg.badge)}>{sCfg.label}</Badge>
                      </td>
                      <td className="py-2 px-3">
                        <Badge className={cn('text-[10px]', pCfg.badge)}>{pCfg.label}</Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {task.assignee_name || '-'}
                      </td>
                      {permissions.canEdit && (
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => unlinkTask(task.id)}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                            title="Unlink task"
                          >
                            <Unlink className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
