"use client"

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Plus, MoreHorizontal, Edit, Trash2, Building2, Globe, Tag, UserPlus, Archive } from 'lucide-react'
import { confirmThen } from '@/components/ui/confirm-dialog'
import { DataTable, ColumnDef, createSortableHeader } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import toast from 'react-hot-toast'

interface Company {
  id: string
  name: string
  industry: string | null
  website: string | null
  phone: string | null
  city: string | null
  country: string | null
  contact_count?: number
  created_at: string
}

interface Props {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialCompanies: any[]
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean }
  tenantId: string
  userId: string
  teamMembers?: { user_id: string; full_name: string }[]
  _tenantId?: string
  _userId?: string
}

export default function CompaniesDataTable({ initialCompanies, permissions, _tenantId, _userId, teamMembers = [] }: Props) {
  const [companies, setCompanies] = useState(initialCompanies)
  const [total, setTotal] = useState(initialCompanies.length)
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [form, setForm] = useState({
    name: '',
    industry: '',
    website: '',
    phone: '',
    city: '',
    country: '',
    notes: '',
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
      const res = await fetch(`/api/tenant/companies?${params}`)
      const data = await res.json()
      setCompanies(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load companies:', error)
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

  const addCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/tenant/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error)
      setSaving(false)
      return
    }
    toast.success('Company created')
    setShowForm(false)
    setForm({ name: '', industry: '', website: '', phone: '', city: '', country: '', notes: '' })
    loadData(pagination.pageIndex)
    setSaving(false)
  }

  const columns: ColumnDef<Company>[] = useMemo(() => [
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
      accessorKey: 'name',
      header: ({ column }) => createSortableHeader('Name', 'name').header({ column }),
      cell: ({ row }) => (
        <Link href={`/tenant/companies/${row.original.id}`}
          className="flex items-center gap-3 hover:bg-accent/30 px-2 py-1 rounded-lg -mx-2 transition-colors cursor-pointer">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {row.original.name.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div className="font-medium truncate">{row.original.name}</div>
        </Link>
      ),
    },
    {
      accessorKey: 'industry',
      header: ({ column }) => createSortableHeader('Industry', 'industry').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">{row.original.industry ?? '—'}</div>
      ),
    },
    {
      accessorKey: 'website',
      header: ({ column }) => createSortableHeader('Website', 'website').header({ column }),
      cell: ({ row }) => {
        const website = row.original.website
        return website ? (
          <a href={website.startsWith('http') ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="text-sm text-violet-600 hover:underline flex items-center gap-1">
            <Globe className="w-3 h-3" />
            {website.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )
      },
    },
    {
      accessorKey: 'phone',
      header: ({ column }) => createSortableHeader('Phone', 'phone').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">{row.original.phone ?? '—'}</div>
      ),
    },
    {
      accessorKey: 'location',
      header: 'Location',
      cell: ({ row }) => {
        const city = row.original.city
        const country = row.original.country
        return (
          <div className="text-sm text-muted-foreground">
            {city || country ? `${city ?? ''}${city && country ? ', ' : ''}${country ?? ''}` : '—'}
          </div>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const company = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.location.href = `/tenant/companies/${company.id}`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={async () => {
                  await confirmThen(`Delete ${company.name}?`, async () => {
                    const res = await fetch(`/api/tenant/companies/${company.id}`, { method: 'DELETE' })
                    if (res.ok) {
                      toast.success('Company deleted')
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
  const [bulkBusy, setBulkBusy] = useState(false)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callBulk = useCallback(async (action: string, ids: string[], payload: Record<string, any> = {}) => {
    setBulkBusy(true)
    try {
      const res = await fetch('/api/tenant/companies/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, company_ids: ids, payload }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${data.action}: ${data.affected} compan${data.affected === 1 ? 'y' : 'ies'}`)
        loadData(pagination.pageIndex)
      } else {
        toast.error(data.error || `Failed to ${action} companies`)
      }
    } finally {
      setBulkBusy(false)
    }
  }, [loadData, pagination.pageIndex])

  const bulkActions = useMemo(() => [
    ...(teamMembers.length > 0 ? [{
      id: 'assign',
      label: 'Assign Owner',
      icon: <UserPlus className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: teamMembers.map(m => ({ value: m.user_id, label: m.full_name })),
      onClick: async (ids: string[], input?: string) => {
        if (!input) return toast.error('Pick a teammate')
        await callBulk('assign', ids, { assigned_to: input })
      },
    }] : []),
    {
      id: 'tag',
      label: 'Add Tag',
      icon: <Tag className="w-3.5 h-3.5" />,
      requiresInput: true,
      inputPlaceholder: 'Tag name',
      onClick: async (ids: string[], input?: string) => {
        if (!input?.trim()) return toast.error('Tag name required')
        await callBulk('tag', ids, { tag: input.trim() })
      },
    },
    {
      id: 'status',
      label: 'Set Status',
      icon: <Archive className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: [
        { value: 'active',   label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
        { value: 'archived', label: 'Archived' },
      ],
      onClick: async (ids: string[], input?: string) => {
        if (!input) return toast.error('Pick a status')
        await callBulk('status', ids, { status: input })
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      requiresConfirmation: true,
      confirmationMessage: 'Soft-delete the selected companies? They can be restored from Trash.',
      onClick: async (ids: string[]) => callBulk('delete', ids),
    },
  ], [teamMembers, callBulk])

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Companies</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} total</p>
        </div>
        {permissions.canCreate && (
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Company
          </Button>
        )}
      </div>

      {/* Add Company Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="font-semibold">New Company</h3>
          <form onSubmit={addCompany} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                required
                className={inp}
                placeholder="e.g., Acme Inc"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Industry</label>
              <input
                value={form.industry}
                onChange={(e) => setForm(f => ({ ...f, industry: e.target.value }))}
                className={inp}
                placeholder="e.g., Technology"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Website</label>
              <input
                value={form.website}
                onChange={(e) => setForm(f => ({ ...f, website: e.target.value }))}
                className={inp}
                placeholder="acme.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                className={inp}
                placeholder="+1 (555) 123-4567"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Country</label>
              <input
                value={form.country}
                onChange={(e) => setForm(f => ({ ...f, country: e.target.value }))}
                className={inp}
                placeholder="United States"
              />
            </div>
            <div className="col-span-2 flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Company'}</Button>
            </div>
          </form>
        </div>
      )}

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={companies}
        total={total}
        loading={loading}
        pageSize={pagination.pageSize}
        onPageSizeChange={handlePageSizeChange}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        enableRowSelection
        enableBulkActions
        bulkActions={bulkActions}
        searchPlaceholder="Search companies by name, industry, or website..."
        manualPagination
        pageIndex={pagination.pageIndex}
        onPaginationChange={handlePaginationChange}
        emptyState={{
          icon: <Building2 className="w-6 h-6 text-muted-foreground" />,
          title: "No companies yet",
          description: "Start building your company list by adding your first company",
          action: permissions.canCreate ? {
            label: "Add Company",
            onClick: () => setShowForm(true),
            icon: <Plus className="w-4 h-4 mr-2" />,
          } : undefined,
        }}
      />
    </div>
  )
}
