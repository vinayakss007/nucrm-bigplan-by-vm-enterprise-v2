"use client"

import { useState, useCallback, useMemo } from 'react'
import { MoreHorizontal, AlertTriangle, CheckCircle, XCircle, Eye } from 'lucide-react'
import { cn, formatRelativeTime } from '@/lib/utils'
import { DataTable, ColumnDef, createSortableHeader } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import toast from 'react-hot-toast';

const LEVEL_COLORS: Record<string, string> = {
  fatal: 'bg-red-500/15 text-red-400 border-red-500/20',
  error: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
}

interface ErrorLog {
  id: string
  level: string
  message: string
  code: string | null
  context: string | null
  stack_trace: string | null
  user_email: string | null
  tenant_name: string | null
  resolved: boolean
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialErrors: any[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  summary: any
}

export default function ErrorsDataTable({ initialErrors, summary }: Props) {
  const [errors, setErrors] = useState(initialErrors)
  const [total, setTotal] = useState(summary?.total || initialErrors.length)
  const [loading, setLoading] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [levelFilter, setLevelFilter] = useState('')
  const [resolvedFilter, setResolvedFilter] = useState('false')

  const loadData = useCallback(async (page = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
      resolved: resolvedFilter,
    })
    if (globalFilter) params.set('q', globalFilter)
    if (levelFilter) params.set('level', levelFilter)
    try {
      const res = await fetch('/api/superadmin/errors?' + params)
      const data = await res.json()
      setErrors(data.errors ?? [])
      setTotal(data.summary?.total ?? 0)
    } catch (error) {
      console.error('Failed to load errors:', error)
    }
    setLoading(false)
  }, [pagination.pageSize, globalFilter, levelFilter, resolvedFilter])

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

  const resolveError = useCallback(async (id: string) => {
    const res = await fetch('/api/superadmin/errors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (res.ok) {
      toast.success('Error marked as resolved')
      loadData(pagination.pageIndex)
    } else {
      toast.error('Failed to resolve')
    }
  }, [loadData, pagination.pageIndex])

  const resolveAll = async () => {
    const res = await fetch('/api/superadmin/errors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolveAll: true }),
    })
    if (res.ok) {
      toast.success('All errors resolved')
      loadData(0)
    } else {
      toast.error('Failed to resolve all')
    }
  }

  const columns: ColumnDef<ErrorLog>[] = useMemo(() => [
    {
      accessorKey: 'level',
      header: ({ column }) => createSortableHeader('Level', 'level').header({ column }),
      cell: ({ row }) => {
        const level = row.original.level.toLowerCase()
        const cfg = LEVEL_COLORS[level] || LEVEL_COLORS["info"]
        return (
          <Badge className={cn('text-xs font-semibold capitalize border', cfg)}>
            {row.original.level}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'message',
      header: ({ column }) => createSortableHeader('Message', 'message').header({ column }),
      cell: ({ row }) => (
        <div className="max-w-[300px] truncate font-medium" title={row.original.message}>
          {row.original.message}
        </div>
      ),
    },
    {
      accessorKey: 'code',
      header: ({ column }) => createSortableHeader('Code', 'code').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground font-mono">
          {row.original.code ?? '—'}
        </div>
      ),
    },
    {
      accessorKey: 'user_email',
      header: 'User',
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {row.original.user_email ?? 'System'}
        </div>
      ),
    },
    {
      accessorKey: 'tenant_name',
      header: 'Tenant',
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">
          {row.original.tenant_name ?? '—'}
        </div>
      ),
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => createSortableHeader('Created', 'created_at').header({ column }),
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {formatRelativeTime(row.original.created_at)}
        </div>
      ),
    },
    {
      accessorKey: 'resolved',
      header: 'Status',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.resolved ? (
            <>
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              <span className="text-xs text-muted-foreground">Resolved</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Open</span>
            </>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const error = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Eye className="mr-2 h-4 w-4" />
                View Details
              </DropdownMenuItem>
              {!error.resolved && (
                <DropdownMenuItem onClick={() => resolveError(error.id)}>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Mark Resolved
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 dark:text-red-400">
                <XCircle className="mr-2 h-4 w-4" />
                Delete Log
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ], [resolveError])

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-violet-400" />
            Error Logs
          </h1>
          <p className="text-xs text-white/40">
            {summary?.unresolved ?? 0} unresolved · {summary?.resolved ?? 0} resolved
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:border-violet-500"
          >
            <option value="">All Levels</option>
            <option value="fatal">Fatal</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <select
            value={resolvedFilter}
            onChange={(e) => setResolvedFilter(e.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:border-violet-500"
          >
            <option value="false">Open Only</option>
            <option value="true">Resolved Only</option>
            <option value="all">All</option>
          </select>
          <Button variant="outline" size="sm" onClick={resolveAll} disabled={!summary?.unresolved}>
            <CheckCircle className="w-4 h-4 mr-2" />
            Resolve All
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-xs text-red-400/60">Fatal</p>
          <p className="text-2xl font-bold text-red-400">{summary?.fatal ?? 0}</p>
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
          <p className="text-xs text-orange-400/60">Errors</p>
          <p className="text-2xl font-bold text-orange-400">{summary?.error ?? 0}</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-xs text-amber-400/60">Warnings</p>
          <p className="text-2xl font-bold text-amber-400">{summary?.warning ?? 0}</p>
        </div>
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
          <p className="text-xs text-blue-400/60">Info</p>
          <p className="text-2xl font-bold text-blue-400">{summary?.info ?? 0}</p>
        </div>
      </div>

      {/* DataTable */}
      <div className="table-responsive rounded-xl border border-white/5">
        <DataTable
          columns={columns}
          data={errors}
          total={total}
          loading={loading}
          pageSize={pagination.pageSize}
          onPageSizeChange={handlePageSizeChange}
          globalFilter={globalFilter}
          onGlobalFilterChange={handleGlobalFilterChange}
          searchPlaceholder="Search errors by message or code..."
          manualPagination
          pageIndex={pagination.pageIndex}
          onPaginationChange={handlePaginationChange}
          emptyState={{
            icon: <CheckCircle className="w-6 h-6 text-white/30" />,
            title: summary?.unresolved ? 'No resolved errors' : 'No errors found',
            description: summary?.unresolved ? 'Try adjusting your filters' : 'All systems operational',
          }}
        />
      </div>
    </div>
  )
}
