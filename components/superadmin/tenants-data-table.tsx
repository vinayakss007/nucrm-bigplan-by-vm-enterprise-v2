"use client"

import { useState, useCallback, useMemo } from 'react'
import { MoreHorizontal, LogIn, AlertTriangle, Edit, XCircle } from 'lucide-react'
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
  active: 'bg-emerald-500/15 text-emerald-400',
  trialing: 'bg-amber-500/15 text-amber-400',
  suspended: 'bg-red-500/15 text-red-400',
  trial_expired: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-slate-500/15 text-slate-400',
  past_due: 'bg-orange-500/15 text-orange-400',
}

const PLAN_COLORS: Record<string, string> = {
  free: 'text-white/30',
  starter: 'text-blue-400',
  pro: 'text-violet-400',
  enterprise: 'text-amber-400',
}

interface Tenant {
  id: string
  name: string
  slug: string
  plan_id: string
  status: string
  trial_ends_at: string | null
  billing_email: string | null
  current_users: number
  current_contacts: number
  created_at: string
  owner_email?: string
}

interface Props {
  initialTenants: any[]
}

export default function TenantsDataTable({ initialTenants }: Props) {
  const [tenants, setTenants] = useState(initialTenants)
  const [total, setTotal] = useState(initialTenants.length)
  const [loading, setLoading] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const loadData = useCallback(async (page = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    if (globalFilter) params.set('q', globalFilter)
    try {
      const res = await fetch('/api/superadmin/tenants?' + params)
      const data = await res.json()
      setTenants(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load tenants:', error)
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

  const impersonate = async (tenantId: string) => {
    const res = await fetch('/api/superadmin/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId }),
    })
    if (res.ok) {
      toast.success('Impersonating tenant...')
      window.location.href = '/tenant/dashboard'
    } else {
      toast.error('Failed to impersonate')
    }
  }

  const suspendTenant = async (tenantId: string, _name: string) => {
    const res = await fetch('/api/superadmin/tenants', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tenantId, status: 'suspended' }),
    })
    if (res.ok) {
      toast.success('Tenant suspended')
      loadData(pagination.pageIndex)
    } else {
      toast.error('Failed to suspend')
    }
  }

  const columns: ColumnDef<Tenant>[] = useMemo(() => [
    {
      accessorKey: 'name',
      header: ({ column }) => createSortableHeader('Name', 'name').header({ column }),
      cell: ({ row }) => (
        <div>
          <div className="font-semibold">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">{row.original.owner_email}</div>
        </div>
      ),
    },
    {
      accessorKey: 'plan_id',
      header: ({ column }) => createSortableHeader('Plan', 'plan_id').header({ column }),
      cell: ({ row }) => (
        <div className={cn('text-sm font-semibold capitalize', PLAN_COLORS[row.original.plan_id] || PLAN_COLORS["free"])}>
          {row.original.plan_id}
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => createSortableHeader('Status', 'status').header({ column }),
      cell: ({ row }) => (
        <Badge className={cn('text-xs font-semibold capitalize', STATUS_COLORS[row.original.status] || STATUS_COLORS["active"])}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'trial_ends_at',
      header: ({ column }) => createSortableHeader('Trial Ends', 'trial_ends_at').header({ column }),
      cell: ({ row }) => {
        const trialEnds = row.original.trial_ends_at
        const daysLeft = trialEnds ? Math.ceil((new Date(trialEnds).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null
        return (
          <div className={cn('text-sm', daysLeft !== null && daysLeft <= 3 ? 'text-red-500 font-semibold' : 'text-muted-foreground')}>
            {trialEnds ? formatDate(trialEnds) : '—'}
            {daysLeft !== null && daysLeft > 0 && <div className="text-xs">{daysLeft} days left</div>}
          </div>
        )
      },
    },
    {
      accessorKey: 'current_users',
      header: ({ column }) => createSortableHeader('Users', 'current_users').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">{row.original.current_users}</div>
      ),
    },
    {
      accessorKey: 'current_contacts',
      header: ({ column }) => createSortableHeader('Contacts', 'current_contacts').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">{row.original.current_contacts.toLocaleString()}</div>
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
        const tenant = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => impersonate(tenant.id)}>
                <LogIn className="mr-2 h-4 w-4" />
                Impersonate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.location.href = `/superadmin/tenants?id=${tenant.id}`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={() => suspendTenant(tenant.id, tenant.name)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Suspend
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
      <div>
        <h1 className="text-lg font-bold text-white">Tenants</h1>
        <p className="text-sm text-white/40">{total.toLocaleString()} organizations</p>
      </div>

      {/* DataTable */}
      <div className="table-responsive rounded-xl border border-white/5">
        <DataTable
          columns={columns}
          data={tenants}
          total={total}
          loading={loading}
          pageSize={pagination.pageSize}
          onPageSizeChange={handlePageSizeChange}
          globalFilter={globalFilter}
          onGlobalFilterChange={handleGlobalFilterChange}
          searchPlaceholder="Search tenants by name, email, or slug..."
          manualPagination
          pageIndex={pagination.pageIndex}
          onPaginationChange={handlePaginationChange}
          emptyState={{
            icon: <AlertTriangle className="w-6 h-6 text-white/30" />,
            title: "No tenants found",
            description: "Try adjusting your search filters",
          }}
        />
      </div>
    </div>
  )
}
