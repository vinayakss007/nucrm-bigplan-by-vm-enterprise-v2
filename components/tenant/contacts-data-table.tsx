"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Upload, Download, MoreHorizontal, Edit, Trash2, AlertCircle, X, UserPlus } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { confirmThen } from '@/components/ui/confirm-dialog'
import { InlineEdit } from '@/components/ui/inline-edit'
import { DataTable, ColumnDef, createSortableHeader } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import ImportModal from './import-modal'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  qualified: 'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400',
  unqualified: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
  converted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
  lost: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

interface Contact {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  company_name: string | null
  lead_status: string
  lead_source: string | null
  assigned_name: string | null
  created_at: string
}

interface Props {
  initialContacts: Contact[]
  companies: { id: string; name: string }[]
  teamMembers: { user_id: string; full_name: string }[]
  permissions: {
    canCreate: boolean
    canEdit: boolean
    canDelete: boolean
    canViewAll: boolean
    canImport?: boolean
    canExport?: boolean
    canAssign?: boolean
  }
  totalCount?: number
  tenantId: string
  userId: string
}

export default function ContactsDataTable({
  initialContacts,
  companies,
  teamMembers,
  permissions,
  totalCount = 0,
  tenantId,
  userId,
}: Props) {
  const [contacts, setContacts] = useState(initialContacts)
  const [total, setTotal] = useState(totalCount)
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<{ id: string; name: string } | null>(null)
  const [addForm, setAddForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company_id: '',
    lead_status: 'new',
    lead_source: '',
    assigned_to: '',
  })
  const [addingContact, setAddingContact] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const router = useRouter()

  const loadData = useCallback(async (page = 0, search = globalFilter) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    if (search) params.set('q', search)
    try {
      const res = await fetch(`/api/tenant/contacts?${params}`)
      const data = await res.json()
      setContacts(data.data ?? [])
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load contacts:', error)
    }
    setLoading(false)
  }, [pagination.pageSize, globalFilter])

  const handleGlobalFilterChange = useCallback((filter: string) => {
    setGlobalFilter(filter)
    loadData(0, filter)
  }, [loadData])

  const handlePaginationChange = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, pageIndex: page }))
    loadData(page)
  }, [loadData])

  const handlePageSizeChange = useCallback((size: number) => {
    setPagination(prev => ({ ...prev, pageSize: size, pageIndex: 0 }))
  }, [])

  // Refresh when component mounts with proper cleanup
  useEffect(() => {
    const abortController = new AbortController()
    const loadDataWithAbort = async () => {
      setLoading(true)
      const params = new URLSearchParams({
        limit: String(pagination.pageSize),
        offset: String(0),
      })
      if (globalFilter) params.set('q', globalFilter)
      try {
        const res = await fetch(`/api/tenant/contacts?${params}`, { signal: abortController.signal })
        const data = await res.json()
        setContacts(data.data ?? [])
        setTotal(data.total ?? 0)
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error('Failed to load contacts:', error)
        }
      }
      setLoading(false)
    }
    loadDataWithAbort()
    return () => abortController.abort()
  }, [, globalFilter])

  const columns: ColumnDef<Contact>[] = useMemo(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
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
      cell: ({ row }) => {
        const contact = row.original
        return (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
              {contact.first_name?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {contact.first_name} {contact.last_name}
              </p>
              {contact.assigned_name && (
                <p className="text-xs text-muted-foreground/80">→ {contact.assigned_name}</p>
              )}
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'company_name',
      header: ({ column }) => createSortableHeader('Company', 'company_name').header({ column }),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.company_name ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'email',
      header: ({ column }) => createSortableHeader('Email', 'email').header({ column }),
      cell: ({ row }) => (
        <InlineEdit value={row.original.email ?? ''} className="text-sm text-muted-foreground truncate max-w-[180px] block"
          onSave={async (v) => {
            await fetch(`/api/tenant/contacts/${row.original.id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: v || null }),
            });
          }} />
      ),
    },
    {
      accessorKey: 'phone',
      header: ({ column }) => createSortableHeader('Phone', 'phone').header({ column }),
      cell: ({ row }) => (
        <InlineEdit value={row.original.phone ?? ''} className="text-sm text-muted-foreground"
          onSave={async (v) => {
            await fetch(`/api/tenant/contacts/${row.original.id}`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phone: v || null }),
            });
          }} />
      ),
    },
    {
      accessorKey: 'lead_status',
      header: ({ column }) => createSortableHeader('Status', 'lead_status').header({ column }),
      cell: ({ row }) => (
        <Badge
          variant="default"
          className={cn(
              'text-sm font-bold capitalize',
            STATUS_COLORS[row.original.lead_status] ?? STATUS_COLORS["new"]
          )}
        >
          {row.original.lead_status}
        </Badge>
      ),
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => createSortableHeader('Added', 'created_at').header({ column }),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const contact = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(`/tenant/contacts/${contact.id}`)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={async () => {
                  await confirmThen(`Delete ${contact.first_name} ${contact.last_name}?`, async () => {
                    const res = await fetch(`/api/tenant/contacts/${contact.id}`, { method: 'DELETE' })
                    if (res.ok) {
                      toast.success('Contact deleted')
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
  ], [pagination.pageIndex, loadData, router])

  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [showBulkAction, setShowBulkAction] = useState<string | null>(null)
  const [bulkPayload, setBulkPayload] = useState<Record<string, string>>({})

  const bulkActions = useMemo(() => [
    {
      id: 'tag',
      label: 'Add Tag',
      requiresInput: true,
      inputPlaceholder: 'Enter tag name',
      onClick: async (selectedIds: string[], input?: string) => {
        if (!input?.trim()) { toast.error('Tag name required'); return; }
        setBulkActionLoading(true)
        const res = await fetch('/api/tenant/contacts/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'tag', contact_ids: selectedIds, payload: { tag: input.trim() } }),
        })
        const data = await res.json()
        if (res.ok) {
          toast.success(`Tagged ${data.affected} contacts`)
          loadData(pagination.pageIndex)
        } else {
          toast.error(data.error || 'Failed to tag contacts')
        }
        setBulkActionLoading(false)
      },
    },
    {
      id: 'untag',
      label: 'Remove Tag',
      requiresInput: true,
      inputPlaceholder: 'Enter tag to remove',
      onClick: async (selectedIds: string[], input?: string) => {
        if (!input?.trim()) { toast.error('Tag name required'); return; }
        setBulkActionLoading(true)
        const res = await fetch('/api/tenant/contacts/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'untag', contact_ids: selectedIds, payload: { tag: input.trim() } }),
        })
        const data = await res.json()
        if (res.ok) {
          toast.success(`Removed tag from ${data.affected} contacts`)
          loadData(pagination.pageIndex)
        } else {
          toast.error(data.error || 'Failed to untag contacts')
        }
        setBulkActionLoading(false)
      },
    },
    {
      id: 'assign',
      label: 'Assign To',
      requiresSelect: true,
      selectOptions: teamMembers.map(m => ({ value: m.user_id, label: m.full_name })),
      onClick: async (selectedIds: string[], input?: string) => {
        if (!input) { toast.error('Select a team member'); return; }
        setBulkActionLoading(true)
        const res = await fetch('/api/tenant/contacts/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'assign', contact_ids: selectedIds, payload: { assign_to: input } }),
        })
        const data = await res.json()
        if (res.ok) {
          toast.success(`Assigned ${data.affected} contacts`)
          loadData(pagination.pageIndex)
        } else {
          toast.error(data.error || 'Failed to assign contacts')
        }
        setBulkActionLoading(false)
      },
    },
    {
      id: 'status',
      label: 'Change Status',
      requiresSelect: true,
      selectOptions: ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'].map(s => ({ value: s, label: s })),
      onClick: async (selectedIds: string[], input?: string) => {
        if (!input) { toast.error('Select a status'); return; }
        setBulkActionLoading(true)
        const res = await fetch('/api/tenant/contacts/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', contact_ids: selectedIds, payload: { lead_status: input } }),
        })
        const data = await res.json()
        if (res.ok) {
          toast.success(`Updated ${data.affected} contacts`)
          loadData(pagination.pageIndex)
        } else {
          toast.error(data.error || 'Failed to update status')
        }
        setBulkActionLoading(false)
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      confirm: true,
      onClick: async (selectedIds: string[]) => {
        setBulkActionLoading(true)
        const res = await fetch('/api/tenant/contacts/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', contact_ids: selectedIds }),
        })
        const data = await res.json()
        if (res.ok) {
          toast.success(`Deleted ${data.affected} contacts`)
          loadData(pagination.pageIndex)
        } else {
          toast.error(data.error || 'Failed to delete contacts')
        }
        setBulkActionLoading(false)
      },
    },
    {
      id: 'export',
      label: 'Export',
      onClick: async (selectedIds: string[]) => {
        setExporting(true)
        const res = await fetch('/api/tenant/contacts/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: selectedIds }),
        })
        if (!res.ok) {
          toast.error('Export failed')
          setExporting(false)
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success(`Exported ${selectedIds.length} contacts`)
        setExporting(false)
      },
    },
  ], [teamMembers, pagination.pageIndex, loadData])

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddingContact(true)
    setDuplicateWarning(null)
    const res = await fetch('/api/tenant/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.is_duplicate) {
        setDuplicateWarning({ id: data.duplicate_id, name: 'existing contact' })
        setAddingContact(false)
        return
      }
      toast.error(data.error || 'Failed to add contact')
      setAddingContact(false)
      return
    }
    toast.success('Contact added successfully')
    setShowAdd(false)
    setAddForm({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      company_id: '',
      lead_status: 'new',
      lead_source: '',
      assigned_to: '',
    })
    loadData(pagination.pageIndex)
    setAddingContact(false)
  }

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} total</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImport(true)}
            disabled={exporting}
          >
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setExporting(true)
              const res = await fetch('/api/tenant/contacts/export')
              if (!res.ok) {
                toast.error('Nothing to export')
                setExporting(false)
                return
              }
              const blob = await res.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `contacts_${new Date().toISOString().split('T')[0]}.csv`
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              URL.revokeObjectURL(url)
              toast.success('Exported contacts')
              setExporting(false)
            }}
            disabled={exporting}
          >
            <Download className="w-4 h-4 mr-2" />
            {exporting ? '...' : 'Export'}
          </Button>
          {permissions.canCreate && (
            <Button
              size="sm"
              onClick={() => setShowAdd(!showAdd)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Contact
            </Button>
          )}
        </div>
      </div>

      {/* Add Contact Form */}
      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">New Contact</h3>
            <button
              onClick={() => { setShowAdd(false); setDuplicateWarning(null) }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {duplicateWarning && (
            <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Duplicate email</p>
                <p className="text-xs text-amber-600/70 mt-0.5">A contact with this email already exists.</p>
              </div>
              <Link
                href={`/tenant/contacts/${duplicateWarning.id}`}
                className="shrink-0 text-xs text-amber-600 hover:underline font-medium"
              >
                View →
              </Link>
            </div>
          )}

          <form onSubmit={handleAddContact} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">
                First Name *
              </label>
              <input
                value={addForm.first_name}
                onChange={(e) => setAddForm(f => ({ ...f, first_name: e.target.value }))}
                required
                className={inp}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">
                Last Name
              </label>
              <input
                value={addForm.last_name}
                onChange={(e) => setAddForm(f => ({ ...f, last_name: e.target.value }))}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">
                Email
              </label>
              <input
                type="email"
                value={addForm.email}
                onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">
                Phone
              </label>
              <input
                value={addForm.phone}
                onChange={(e) => setAddForm(f => ({ ...f, phone: e.target.value }))}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">
                Company
              </label>
              <select
                value={addForm.company_id}
                onChange={(e) => setAddForm(f => ({ ...f, company_id: e.target.value }))}
                className={inp}
              >
                <option value="">No company</option>
                {companies.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">
                Lead Source
              </label>
              <select
                value={addForm.lead_source}
                onChange={(e) => setAddForm(f => ({ ...f, lead_source: e.target.value }))}
                className={inp}
              >
                <option value="">Select source</option>
                {['website', 'referral', 'cold_outreach', 'social_media', 'event', 'inbound', 'other'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 flex gap-2 justify-end pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowAdd(false); setDuplicateWarning(null) }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addingContact}>
                {addingContact ? 'Adding...' : 'Add Contact'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={contacts}
        total={total}
        loading={loading}
        pageSize={pagination.pageSize}
        onPageSizeChange={handlePageSizeChange}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        enableRowSelection
        enableBulkActions
        bulkActions={bulkActions}
        searchPlaceholder="Search contacts by name, email, or company..."
        manualPagination
        pageIndex={pagination.pageIndex}
        onPaginationChange={handlePaginationChange}
        emptyState={{
          icon: <UserPlus className="w-6 h-6 text-muted-foreground" />,
          title: "No contacts yet",
          description: "Start building your contact list by adding your first contact or importing from CSV",
          action: permissions.canCreate ? {
            label: "Add Contact",
            onClick: () => setShowAdd(true),
            icon: <Plus className="w-4 h-4 mr-2" />,
          } : undefined,
        }}
      />

      {showImport && (
        <ImportModal
          onDone={() => {
            setShowImport(false)
            loadData(0)
          }}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}
