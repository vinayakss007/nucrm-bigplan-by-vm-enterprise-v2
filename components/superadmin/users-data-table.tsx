"use client"

import { useState, useCallback, useMemo } from 'react'
import { Crown, XCircle, CheckCircle, Plus, Mail, Loader2 } from 'lucide-react'
import { cn, formatRelativeTime } from '@/lib/utils'
import { DataTable, ColumnDef, createSortableHeader } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import toast from 'react-hot-toast'

interface User {
  id: string
  email: string
  full_name: string | null
  is_super_admin: boolean
  email_verified: boolean
  last_seen_at: string | null
  created_at: string
  tenant_count?: number
}

interface Props {
  initialUsers: any[]
}

export default function UsersDataTable({ initialUsers }: Props) {
  const [users, setUsers] = useState(initialUsers)
  const [total, setTotal] = useState(initialUsers.length)
  const [loading, setLoading] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', password: '' })
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async (page = 0) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    if (globalFilter) params.set('q', globalFilter)
    try {
      const res = await fetch('/api/superadmin/users?' + params)
      const data = await res.json()
      setUsers(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load users:', error)
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

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/superadmin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, is_super_admin: false }),
    })
    const data = await res.json()
    if (res.ok) {
      toast.success('User created')
      setShowCreate(false)
      setForm({ email: '', full_name: '', password: '' })
      loadData(0)
    } else {
      toast.error(data.error)
    }
    setSaving(false)
  }

  const columns: ColumnDef<User>[] = useMemo(() => [
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
      accessorKey: 'email',
      header: ({ column }) => createSortableHeader('Email', 'email').header({ column }),
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.email}</div>
          {row.original.full_name && (
            <div className="text-xs text-muted-foreground">{row.original.full_name}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'is_super_admin',
      header: 'Role',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.is_super_admin ? (
            <Badge className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/20">
              <Crown className="w-3 h-3 mr-1" />
              Super Admin
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              User
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'email_verified',
      header: 'Verified',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {row.original.email_verified ? (
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-xs text-muted-foreground">
            {row.original.email_verified ? 'Verified' : 'Unverified'}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => createSortableHeader('Created', 'created_at').header({ column }),
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">{formatRelativeTime(row.original.created_at)}</div>
      ),
    },
  ], [pagination.pageIndex, loadData])

  const inp = "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-violet-500"

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Mail className="w-5 h-5 text-violet-400" />
            All Users
          </h1>
          <p className="text-xs text-white/40">{total.toLocaleString()} users across all organizations</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-2" />
          Create User
        </Button>
      </div>

      {showCreate && (
        <form onSubmit={createUser} className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Create User</p>
            <Badge variant="outline" className="text-xs text-violet-400 border-violet-400/30">Regular user only</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                required
                className={inp}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Full Name</label>
              <input
                value={form.full_name}
                onChange={(e) => setForm(f => ({ ...f, full_name: e.target.value }))}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1">Password *</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                required
                minLength={12}
                className={inp}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              Create User
            </Button>
          </div>
        </form>
      )}

      <div className="table-responsive rounded-xl border border-white/5">
        <DataTable
          columns={columns}
          data={users}
          total={total}
          loading={loading}
          pageSize={pagination.pageSize}
          onPageSizeChange={handlePageSizeChange}
          globalFilter={globalFilter}
          onGlobalFilterChange={handleGlobalFilterChange}
          enableRowSelection
          searchPlaceholder="Search by email or name..."
          manualPagination
          pageIndex={pagination.pageIndex}
          onPaginationChange={handlePaginationChange}
          emptyState={{
            icon: <Mail className="w-6 h-6 text-white/30" />,
            title: "No users found",
            description: "Try adjusting your search filters",
          }}
        />
      </div>
    </div>
  )
}
