"use client"

import { useState, useCallback, useMemo } from 'react'
import { Plus, MoreHorizontal, Edit, Trash2, CheckCircle, AlertTriangle, Columns, UserPlus, Flag, Calendar as CalendarIcon, RotateCcw } from 'lucide-react'
import { cn, formatDate, formatRelativeTime } from '@/lib/utils'
import { DataTable, ColumnDef, createSortableHeader } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import toast from 'react-hot-toast'
import { confirmThen } from '@/components/ui/confirm-dialog'

const PRIORITY_CFG = {
  high: { label: 'High', dot: 'bg-red-500', badge: 'text-red-600 bg-red-100 dark:bg-red-900/20 dark:text-red-400' },
  medium: { label: 'Medium', dot: 'bg-amber-500', badge: 'text-amber-600 bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400' },
  low: { label: 'Low', dot: 'bg-slate-400', badge: 'text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-400' },
}

interface Task {
  id: string
  title: string
  description: string | null
  priority: string
  due_date: string | null
  completed: boolean
  completed_at: string | null
  contact_name: string | null
  deal_title: string | null
  assignee_name: string | null
  created_at: string
}

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialTasks: any[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  contacts: any[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  deals: any[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  teamMembers: any[]
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean; canAssign: boolean }
}

export default function TasksDataTable({ initialTasks, contacts, deals, teamMembers, permissions }: Props) {
  const [tasks, setTasks] = useState(initialTasks)
  const [total, setTotal] = useState(initialTasks.length)
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    due_date: '',
    contact_id: '',
    deal_id: '',
    assigned_to: '',
  })
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async (page = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    if (globalFilter) params.set('q', globalFilter)
    try {
      const res = await fetch(`/api/tenant/tasks?${params}`)
      const data = await res.json()
      setTasks(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load tasks:', error)
    }
    setLoading(false)
  }, [pagination.pageSize, globalFilter])

  const handlePaginationChange = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, pageIndex: page }))
    loadData(page)
  }, [loadData])

  const handlePageSizeChange = useCallback((size: number) => {
    setPagination(prev => ({ ...prev, pageSize: size, pageIndex: 0 }))
  }, [])

  const handleGlobalFilterChange = useCallback((filter: string) => {
    setGlobalFilter(filter)
    loadData(0)
  }, [loadData])

  const toggleTaskComplete = async (taskId: string, completed: boolean) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed } : t))
    const res = await fetch(`/api/tenant/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    })
    if (!res.ok) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: !completed } : t))
      toast.error('Failed to update task')
    } else {
      toast.success(completed ? 'Task completed' : 'Task reopened')
    }
  }

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/tenant/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        contact_id: form.contact_id || null,
        deal_id: form.deal_id || null,
        assigned_to: form.assigned_to || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error)
      setSaving(false)
      return
    }
    toast.success('Task created')
    setShowAdd(false)
    setForm({ title: '', description: '', priority: 'medium', due_date: '', contact_id: '', deal_id: '', assigned_to: '' })
    loadData(pagination.pageIndex)
    setSaving(false)
  }

  const today = new Date().toISOString().split('T')[0] || ''

  const columns: ColumnDef<Task>[] = useMemo(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      id: 'complete',
      header: '',
      cell: ({ row }) => (
        <Checkbox
          checked={row.original.completed}
          onCheckedChange={(value) => toggleTaskComplete(row.original.id, value === true)}
          aria-label="Toggle complete"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'title',
      header: ({ column }) => createSortableHeader('Title', 'title').header({ column }),
      cell: ({ row }) => (
        <Link href={`/tenant/tasks/${row.original.id}`} className={cn('font-medium truncate max-w-[200px] block hover:text-violet-600 transition-colors', row.original.completed && 'line-through text-muted-foreground')}>
          {row.original.title}
        </Link>
      ),
    },
    {
      accessorKey: 'priority',
      header: ({ column }) => createSortableHeader('Priority', 'priority').header({ column }),
      cell: ({ row }) => {
        const priority = PRIORITY_CFG[row.original.priority as keyof typeof PRIORITY_CFG] || PRIORITY_CFG.medium
        return (
          <Badge className={cn('text-xs font-semibold flex items-center gap-1.5 w-fit', priority.badge)}>
            <div className={cn('w-1.5 h-1.5 rounded-full', priority.dot)} />
            {priority.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'due_date',
      header: ({ column }) => createSortableHeader('Due Date', 'due_date').header({ column }),
      cell: ({ row }) => {
        const dueDate = row.original.due_date
        const isOverdue = dueDate && dueDate < today && !row.original.completed
        return (
          <div className={cn('text-sm whitespace-nowrap flex items-center gap-1.5', isOverdue && 'text-red-600 font-semibold')}>
            {isOverdue && <AlertTriangle className="w-3 h-3" />}
            {dueDate ? formatDate(dueDate) : '—'}
          </div>
        )
      },
    },
    {
      accessorKey: 'contact_name',
      header: 'Related To',
      cell: ({ row }) => {
        const contact = row.original.contact_name
        const deal = row.original.deal_title
        return (
          <div className="text-sm text-muted-foreground">
            {contact ? `👤 ${contact}` : deal ? `💼 ${deal}` : '—'}
          </div>
        )
      },
    },
    {
      accessorKey: 'assignee_name',
      header: ({ column }) => createSortableHeader('Assignee', 'assignee_name').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">{row.original.assignee_name ?? '—'}</div>
      ),
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => createSortableHeader('Created', 'created_at').header({ column }),
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">{formatRelativeTime(row.original.created_at)}</div>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const task = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleTaskComplete(task.id, !task.completed)}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Mark {task.completed ? 'Incomplete' : 'Complete'}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={async () => {
                  await confirmThen(`Delete "${task.title}"?`, async () => {
                    const res = await fetch(`/api/tenant/tasks/${task.id}`, { method: 'DELETE' })
                    if (res.ok) {
                      toast.success('Task deleted')
                      loadData(pagination.pageIndex)
                    } else {
                      toast.error('Failed to delete')
                    }
                  })
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [pagination.pageIndex, loadData])

  // ── Bulk actions ──────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callBulk = useCallback(async (action: string, ids: string[], payload: Record<string, any> = {}) => {
    const res = await fetch('/api/tenant/tasks/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, task_ids: ids, payload }),
    })
    const data = await res.json()
    if (res.ok) {
      toast.success(`${data.action}: ${data.affected} task(s)`)
      loadData(pagination.pageIndex)
    } else {
      toast.error(data.error || `Failed to ${action} tasks`)
    }
  }, [loadData, pagination.pageIndex])

  const bulkActions = useMemo(() => [
    {
      id: 'complete',
      label: 'Mark Complete',
      icon: <CheckCircle className="w-3.5 h-3.5" />,
      onClick: async (ids: string[]) => callBulk('complete', ids),
    },
    {
      id: 'reopen',
      label: 'Reopen',
      icon: <RotateCcw className="w-3.5 h-3.5" />,
      onClick: async (ids: string[]) => callBulk('reopen', ids),
    },
    {
      id: 'priority',
      label: 'Priority',
      icon: <Flag className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: [
        { value: 'urgent', label: 'Urgent' },
        { value: 'high',   label: 'High' },
        { value: 'medium', label: 'Medium' },
        { value: 'low',    label: 'Low' },
      ],
      onClick: async (ids: string[], input?: string) => {
        if (!input) return toast.error('Pick a priority')
        await callBulk('priority', ids, { priority: input })
      },
    },
    ...(teamMembers.length > 0 ? [{
      id: 'assign',
      label: 'Assign',
      icon: <UserPlus className="w-3.5 h-3.5" />,
      requiresSelect: true,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      selectOptions: teamMembers.map((m: any) => ({ value: m.user_id, label: m.full_name })),
      onClick: async (ids: string[], input?: string) => {
        if (!input) return toast.error('Pick a teammate')
        await callBulk('assign', ids, { assigned_to: input })
      },
    }] : []),
    {
      id: 'due',
      label: 'Set Due Date',
      icon: <CalendarIcon className="w-3.5 h-3.5" />,
      requiresInput: true,
      inputPlaceholder: 'YYYY-MM-DD',
      onClick: async (ids: string[], input?: string) => {
        if (!input?.trim()) return toast.error('Pick a date (YYYY-MM-DD)')
        await callBulk('due', ids, { due_date: input.trim() })
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      requiresConfirmation: true,
      confirmationMessage: 'Soft-delete the selected tasks? They can be restored from Trash.',
      onClick: async (ids: string[]) => callBulk('delete', ids),
    },
  ], [teamMembers, callBulk])

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Tasks</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} total</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/tenant/tasks/kanban" className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-all">
            <Columns className="w-4 h-4" />
            <span className="hidden sm:inline">Kanban</span>
          </Link>
          {permissions.canCreate && (
            <Button onClick={() => setShowAdd(!showAdd)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Task
            </Button>
          )}
        </div>
      </div>

      {/* Add Task Form */}
      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="font-semibold">New Task</h3>
          <form onSubmit={addTask} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                required
                className={inp}
                placeholder="e.g., Follow up with John Doe"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                className={inp}
                placeholder="Add details..."
                rows={3}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))}
                className={inp}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Due Date</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm(f => ({ ...f, due_date: e.target.value }))}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Contact</label>
              <select
                value={form.contact_id}
                onChange={(e) => setForm(f => ({ ...f, contact_id: e.target.value }))}
                className={inp}
              >
                <option value="">No contact</option>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {(contacts || []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Deal</label>
              <select
                value={form.deal_id}
                onChange={(e) => setForm(f => ({ ...f, deal_id: e.target.value }))}
                className={inp}
              >
                <option value="">No deal</option>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {(deals || []).map((d: any) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Assigned To</label>
              <select
                value={form.assigned_to}
                onChange={(e) => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                className={inp}
              >
                <option value="">Unassigned</option>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
                {(teamMembers || []).map((m: any) => (
                  <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Task'}</Button>
            </div>
          </form>
        </div>
      )}

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={tasks}
        total={total}
        loading={loading}
        pageSize={pagination.pageSize}
        onPageSizeChange={handlePageSizeChange}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        enableRowSelection
        enableBulkActions
        bulkActions={bulkActions}
        searchPlaceholder="Search tasks by title, contact, or deal..."
        manualPagination
        pageIndex={pagination.pageIndex}
        onPaginationChange={handlePaginationChange}
        emptyState={{
          icon: <CheckCircle className="w-6 h-6 text-muted-foreground" />,
          title: "No tasks yet",
          description: "Create your first task to stay on top of your follow-ups",
          action: permissions.canCreate ? {
            label: "Add Task",
            onClick: () => setShowAdd(true),
            icon: <Plus className="w-4 h-4 mr-2" />,
          } : undefined,
        }}
      />
    </div>
  )
}
