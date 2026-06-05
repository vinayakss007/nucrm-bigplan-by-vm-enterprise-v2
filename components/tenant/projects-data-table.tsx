"use client"

import { useState, useCallback, useMemo } from 'react'
import { Plus, MoreHorizontal, Edit, Trash2, FolderKanban } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { DataTable, ColumnDef } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import toast from 'react-hot-toast'
import { confirmThen } from '@/components/ui/confirm-dialog'

const STATUS_CFG: Record<string, { label: string; badge: string }> = {
  active: { label: 'Active', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  'on-hold': { label: 'On Hold', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  completed: { label: 'Completed', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
}

interface Project {
  id: string
  name: string
  description: string | null
  status: string
  start_date: string | null
  end_date: string | null
  owner_id: string | null
  owner_name: string | null
  task_count: number
  completed_count: number
  created_at: string
}

interface Props {
  initialProjects: Project[]
  teamMembers: { user_id: string; full_name: string }[]
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean }
}

const emptyForm = {
  name: '',
  description: '',
  status: 'active',
  start_date: '',
  end_date: '',
  owner_id: '',
}

export default function ProjectsDataTable({ initialProjects, teamMembers, permissions }: Props) {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [total, setTotal] = useState(initialProjects.length)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const loadData = useCallback(async (page = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    try {
      const res = await fetch(`/api/tenant/projects?${params}`)
      const data = await res.json()
      setProjects(data.data?.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        start_date: p.startDate,
        end_date: p.endDate,
        owner_id: p.ownerId,
        owner_name: p.ownerName,
        task_count: p.taskCount ?? 0,
        completed_count: p.completedCount ?? 0,
        created_at: p.createdAt,
      })) ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
    setLoading(false)
  }, [pagination.pageSize])

  const handlePaginationChange = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, pageIndex: page }))
    loadData(page)
  }, [loadData])

  const handlePageSizeChange = useCallback((size: number) => {
    setPagination(prev => ({ ...prev, pageSize: size, pageIndex: 0 }))
  }, [])

  const handleGlobalFilterChange = useCallback((filter: string) => {
    setGlobalFilter(filter)
  }, [])

  const openCreate = () => {
    setForm(emptyForm)
    setShowCreate(true)
  }

  const openEdit = (project: Project) => {
    setForm({
      name: project.name,
      description: project.description || '',
      status: project.status,
      start_date: project.start_date || '',
      end_date: project.end_date || '',
      owner_id: project.owner_id || '',
    })
    setEditProject(project)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const isEdit = !!editProject
    const url = isEdit
      ? `/api/tenant/projects/${editProject.id}`
      : '/api/tenant/projects'
    const method = isEdit ? 'PATCH' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          status: form.status,
          start_date: form.start_date || undefined,
          end_date: form.end_date || undefined,
          owner_id: form.owner_id || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to save project')
        setSaving(false)
        return
      }
      toast.success(isEdit ? 'Project updated' : 'Project created')
      setShowCreate(false)
      setEditProject(null)
      setForm(emptyForm)
      loadData(pagination.pageIndex)
    } catch {
      toast.error('Failed to save project')
    }
    setSaving(false)
  }

  const handleDelete = async (project: Project) => {
    await confirmThen(`Delete "${project.name}"?`, async () => {
      const res = await fetch(`/api/tenant/projects/${project.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Project deleted')
        loadData(pagination.pageIndex)
      } else {
        toast.error('Failed to delete project')
      }
    })
  }

  const columns: ColumnDef<Project>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link
          href={`/tenant/projects/${row.original.id}`}
          className="font-medium text-sm hover:text-violet-600 transition-colors truncate max-w-[200px] block"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const cfg = STATUS_CFG[row.original.status] ?? { label: 'Active', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
        return (
          <Badge className={cn('text-xs font-semibold', cfg.badge)}>
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'owner_name',
      header: 'Owner',
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {row.original.owner_name || '-'}
        </div>
      ),
    },
    {
      accessorKey: 'start_date',
      header: 'Start Date',
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {row.original.start_date ? formatDate(row.original.start_date) : '-'}
        </div>
      ),
    },
    {
      accessorKey: 'end_date',
      header: 'End Date',
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {row.original.end_date ? formatDate(row.original.end_date) : '-'}
        </div>
      ),
    },
    {
      id: 'progress',
      header: 'Progress',
      cell: ({ row }) => {
        const { task_count, completed_count } = row.original
        const pct = task_count > 0 ? Math.round((completed_count / task_count) * 100) : 0
        return (
          <div className="flex items-center gap-2 min-w-[100px]">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  pct === 100 ? 'bg-emerald-500' : 'bg-violet-500'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {pct}%
            </span>
          </div>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const project = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {permissions.canEdit && (
                <DropdownMenuItem onClick={() => openEdit(project)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
              )}
              {permissions.canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600 dark:text-red-400"
                    onClick={() => handleDelete(project)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [permissions])

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
        <input
          value={form.name}
          onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
          required
          className={inp}
          placeholder="Project name"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
          className={inp}
          placeholder="Optional description..."
          rows={3}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
          <select
            value={form.status}
            onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}
            className={inp}
          >
            <option value="active">Active</option>
            <option value="on-hold">On Hold</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Owner</label>
          <select
            value={form.owner_id}
            onChange={(e) => setForm(f => ({ ...f, owner_id: e.target.value }))}
            className={inp}
          >
            <option value="">Unassigned</option>
            {teamMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Start Date</label>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setForm(f => ({ ...f, start_date: e.target.value }))}
            className={inp}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">End Date</label>
          <input
            type="date"
            value={form.end_date}
            onChange={(e) => setForm(f => ({ ...f, end_date: e.target.value }))}
            className={inp}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => { setShowCreate(false); setEditProject(null) }}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : editProject ? 'Update Project' : 'Create Project'}
        </Button>
      </DialogFooter>
    </form>
  )

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">{total} total</p>
        </div>
        {permissions.canCreate && (
          <Button onClick={openCreate} className="bg-violet-600 hover:bg-violet-700 text-white">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        )}
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={projects}
        total={total}
        loading={loading}
        pageSize={pagination.pageSize}
        onPageSizeChange={handlePageSizeChange}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        manualPagination
        pageIndex={pagination.pageIndex}
        onPaginationChange={handlePaginationChange}
        searchPlaceholder="Search projects..."
        emptyState={{
          icon: <FolderKanban className="w-6 h-6 text-muted-foreground" />,
          title: "No projects yet",
          description: "Create your first project to start tracking progress",
          action: permissions.canCreate ? {
            label: "New Project",
            onClick: openCreate,
            icon: <Plus className="w-4 h-4 mr-2" />,
          } : undefined,
        }}
      />

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editProject} onOpenChange={(open) => { if (!open) setEditProject(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    </div>
  )
}
