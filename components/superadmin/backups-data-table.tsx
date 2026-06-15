"use client"

import { useState, useCallback, useMemo } from 'react'
import { MoreHorizontal, Download, Trash2, RefreshCw, Database, Cloud, HardDrive, CheckCircle, Clock, AlertTriangle } from 'lucide-react'
import { cn, formatDate, formatRelativeTime } from '@/lib/utils'
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

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-400',
  running: 'bg-blue-500/15 text-blue-400',
  failed: 'bg-red-500/15 text-red-400',
  pending: 'bg-amber-500/15 text-amber-400',
}

const TYPE_COLORS: Record<string, string> = {
  full: 'bg-violet-500/15 text-violet-400',
  incremental: 'bg-blue-500/15 text-blue-400',
  manual: 'bg-amber-500/15 text-amber-400',
}

interface BackupRecord {
  id: string
  type: string
  status: string
  size_bytes: number
  file_path: string | null
  storage_type: string
  started_at: string
  completed_at: string | null
  error_message: string | null
  created_by: string | null
}

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialBackups: any[]
}

export default function BackupsDataTable({ initialBackups }: Props) {
  const [backups, setBackups] = useState(initialBackups)
  const [total, setTotal] = useState(initialBackups.length)
  const [loading, setLoading] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const loadData = useCallback(async (page = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    if (globalFilter) params.set('q', globalFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (typeFilter) params.set('type', typeFilter)
    try {
      const res = await fetch('/api/superadmin/backups?' + params)
      const data = await res.json()
      setBackups(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load backups:', error)
    }
    setLoading(false)
  }, [pagination.pageSize, globalFilter, statusFilter, typeFilter])

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

  const runBackup = async () => {
    const res = await fetch('/api/superadmin/backups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'manual' }),
    })
    if (res.ok) {
      toast.success('Backup started')
      loadData(0)
    } else {
      toast.error('Failed to start backup')
    }
  }

  const deleteBackup = async (id: string) => {
    const res = await fetch(`/api/superadmin/backups/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      toast.success('Backup deleted')
      loadData(pagination.pageIndex)
    } else {
      toast.error('Failed to delete')
    }
  }

  const downloadBackup = async (id: string, _filePath: string) => {
    toast.success('Download started')
    // In production, this would trigger a signed URL download
    window.open(`/api/superadmin/backups/${id}/download`, '_blank')
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return '—'
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) return `${gb.toFixed(2)} GB`
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(0)} MB`
  }

  const columns: ColumnDef<BackupRecord>[] = useMemo(() => [
    {
      accessorKey: 'type',
      header: ({ column }) => createSortableHeader('Type', 'type').header({ column }),
      cell: ({ row }) => {
        const type = row.original.type
        const cfg = TYPE_COLORS[type] || TYPE_COLORS["manual"]
        return (
          <Badge className={cn('text-xs font-semibold capitalize', cfg)}>
            {type}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => createSortableHeader('Status', 'status').header({ column }),
      cell: ({ row }) => {
        const status = row.original.status
        const cfg = STATUS_COLORS[status] || STATUS_COLORS["pending"]
        return (
          <Badge className={cn('text-xs font-semibold capitalize', cfg)}>
            {status === 'running' && <Clock className="w-3 h-3 mr-1 animate-pulse" />}
            {status === 'completed' && <CheckCircle className="w-3 h-3 mr-1" />}
            {status === 'failed' && <AlertTriangle className="w-3 h-3 mr-1" />}
            {status}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'size_bytes',
      header: ({ column }) => createSortableHeader('Size', 'size_bytes').header({ column }),
      cell: ({ row }) => (
        <div className="font-mono text-sm">{formatSize(row.original.size_bytes)}</div>
      ),
    },
    {
      accessorKey: 'storage_type',
      header: 'Storage',
      cell: ({ row }) => {
        const type = row.original.storage_type
        return (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {type === 's3' && <Cloud className="w-3 h-3" />}
            {type === 'local' && <HardDrive className="w-3 h-3" />}
            {type}
          </div>
        )
      },
    },
    {
      accessorKey: 'started_at',
      header: ({ column }) => createSortableHeader('Started', 'started_at').header({ column }),
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {formatDate(row.original.started_at)}
        </div>
      ),
    },
    {
      accessorKey: 'completed_at',
      header: 'Completed',
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {row.original.completed_at ? formatRelativeTime(row.original.completed_at) : '—'}
        </div>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const backup = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {backup.file_path && backup.status === 'completed' && (
                <DropdownMenuItem onClick={() => downloadBackup(backup.id, backup.file_path!)}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={() => deleteBackup(backup.id)}
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

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-violet-400" />
            Database Backups
          </h1>
          <p className="text-xs text-white/40">{total.toLocaleString()} backups</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:border-violet-500"
          >
            <option value="">All Status</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white focus:outline-none focus:border-violet-500"
          >
            <option value="">All Types</option>
            <option value="full">Full</option>
            <option value="incremental">Incremental</option>
            <option value="manual">Manual</option>
          </select>
          <Button onClick={runBackup}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Run Backup
          </Button>
        </div>
      </div>

      {/* DataTable */}
      <div className="table-responsive rounded-xl border border-white/5">
        <DataTable
          columns={columns}
          data={backups}
          total={total}
          loading={loading}
          pageSize={pagination.pageSize}
          onPageSizeChange={handlePageSizeChange}
          globalFilter={globalFilter}
          onGlobalFilterChange={handleGlobalFilterChange}
          searchPlaceholder="Search backups..."
          manualPagination
          pageIndex={pagination.pageIndex}
          onPaginationChange={handlePaginationChange}
          emptyState={{
            icon: <Database className="w-6 h-6 text-white/30" />,
            title: "No backups found",
            description: "Run your first backup to get started",
            action: {
              label: "Run Backup",
              onClick: runBackup,
              icon: <RefreshCw className="w-4 h-4 mr-2" />,
            },
          }}
        />
      </div>
    </div>
  )
}
