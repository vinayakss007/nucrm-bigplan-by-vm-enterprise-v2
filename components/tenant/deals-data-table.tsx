"use client"

import { useState, useCallback, useMemo, useEffect } from 'react'
import { Plus, MoreHorizontal, Edit, Trash2, DollarSign, Tag, UserPlus, ArrowRightLeft, Trophy, Layers, Archive, RotateCcw } from 'lucide-react'
import { cn, formatCurrency, formatDate, toSnakeCase } from '@/lib/utils'
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

import { useDeleteWithUndo } from '@/lib/use-delete-with-undo'
import { InlineContactCreate, InlineCompanyCreate } from '@/components/tenant/inline-create-dialog'

const STAGES = [
  { id: 'lead', label: 'Lead', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { id: 'qualified', label: 'Qualified', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' },
  { id: 'proposal', label: 'Proposal', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-400' },
  { id: 'negotiation', label: 'Negotiation', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' },
  { id: 'won', label: 'Won', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400' },
  { id: 'lost', label: 'Lost', color: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' },
]

interface Deal {
  id: string
  title: string
  amount: number
  stage_name: string
  close_date: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  assigned_to: string | null
  created_at: string
}

interface ContactOpt { id: string; first_name: string; last_name: string }
interface CompanyOpt { id: string; name: string }
interface TeamMemberOpt { user_id: string; full_name: string }

interface Props {
  initialDeals: Deal[]
  contacts: ContactOpt[]
  companies: CompanyOpt[]
  teamMembers: TeamMemberOpt[]
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean }
}

export default function DealsDataTable({ initialDeals, contacts: initialContacts, companies: initialCompanies, teamMembers, permissions }: Props) {
  const [deals, setDeals] = useState(initialDeals)
  const [contactList, setContactList] = useState(initialContacts)
  const [companyList, setCompanyList] = useState(initialCompanies)
  const [total, setTotal] = useState(initialDeals.length)
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [stages, setStages] = useState<{ id: string; name: string; pipeline: string }[]>([])
  const [form, setForm] = useState({
    title: '',
    amount: '',
    stage_name: 'lead',
    contact_id: '',
    company_id: '',
    assigned_to: '',
    close_date: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [selectAllMatching, setSelectAllMatching] = useState(false)

  const loadData = useCallback(async (page = 0, filterOverride?: string) => {
    setLoading(true)
    const params = new URLSearchParams({
      limit: String(pagination.pageSize),
      offset: String(page * pagination.pageSize),
    })
    const q = filterOverride !== undefined ? filterOverride : globalFilter
    if (q) params.set('q', q)
    try {
      const res = await fetch(`/api/tenant/deals?${params}`)
      const data = await res.json()
      setDeals((data.data ?? []).map((d: Record<string, unknown>) => toSnakeCase(d)))
      setTotal(data.total ?? 0)
    } catch (error) {
      console.error('Failed to load deals:', error)
    }
    setLoading(false)
  }, [pagination.pageSize, globalFilter])

  const { deleteEntity } = useDeleteWithUndo('deal', loadData)

  const handlePaginationChange = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, pageIndex: page }))
    loadData(page)
  }, [loadData])

  const handlePageSizeChange = useCallback((size: number) => {
    setPagination(prev => ({ ...prev, pageSize: size, pageIndex: 0 }))
  }, [])

  const handleGlobalFilterChange = useCallback((filter: string) => {
    setGlobalFilter(filter)
    loadData(0, filter)
  }, [loadData])

  // Load pipelines/stages once for the bulk-stage selector
  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/pipelines')
      .then(r => r.ok ? r.json() : { data: [] })
      .then((d: { data?: { id: string; name: string; stages: { id: string; name: string }[] }[] }) => {
        if (cancelled) return
        const flat: { id: string; name: string; pipeline: string }[] = []
        for (const p of d.data ?? []) {
          for (const s of p.stages ?? []) {
            flat.push({ id: s.id, name: s.name, pipeline: p.name })
          }
        }
        setStages(flat)
      })
      .catch((e) => console.error('[deals-data-table] stages fetch failed:', e))
    return () => { cancelled = true }
  }, [])

  const addDeal = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/tenant/deals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        amount: Number(form.amount) || 0,
        contact_id: form.contact_id || null,
        company_id: form.company_id || null,
        assigned_to: form.assigned_to || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error)
      setSaving(false)
      return
    }
    toast.success('Deal created')
    setShowAdd(false)
    setForm({ title: '', amount: '', stage_name: 'lead', contact_id: '', company_id: '', assigned_to: '', close_date: '', description: '' })
    loadData(pagination.pageIndex)
    setSaving(false)
  }

  const columns: ColumnDef<Deal>[] = useMemo(() => [
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
      accessorKey: 'title',
      header: ({ column }) => createSortableHeader('Title', 'title').header({ column }),
      cell: ({ row }) => (
        <Link href={`/tenant/deals/${row.original.id}`} className="font-medium truncate max-w-[200px] block hover:text-violet-600 transition-colors">{row.original.title}</Link>
      ),
    },
    {
      accessorKey: 'amount',
      header: ({ column }) => createSortableHeader('Value', 'amount').header({ column }),
      cell: ({ row }) => (
        <div className="font-semibold text-violet-600">{formatCurrency(row.original.amount)}</div>
      ),
    },
    {
      accessorKey: 'stage_name',
      header: ({ column }) => createSortableHeader('Stage', 'stage_name').header({ column }),
      cell: ({ row }) => {
        const stageName = row.original.stage_name?.toLowerCase() || ''
        const stage = STAGES.find(s => s.id === stageName) || STAGES[0]!
        return <Badge className={cn('text-xs font-semibold', stage.color)}>{stage.label}</Badge>
      },
    },
    {
      accessorKey: 'contact_name',
      header: ({ column }) => createSortableHeader('Contact', 'contact_name').header({ column }),
      cell: ({ row }) => {
        const name = [row.original.first_name, row.original.last_name].filter(Boolean).join(' ')
        return <div className="text-sm text-muted-foreground">{name || '—'}</div>
      },
    },
    {
      accessorKey: 'company_name',
      header: ({ column }) => createSortableHeader('Company', 'company_name').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground">{row.original.company_name ?? '—'}</div>
      ),
    },
    {
      accessorKey: 'close_date',
      header: ({ column }) => createSortableHeader('Close Date', 'close_date').header({ column }),
      cell: ({ row }) => (
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {row.original.close_date ? formatDate(row.original.close_date) : '—'}
        </div>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const deal = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="min-h-11 min-w-11 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => window.location.href = `/tenant/deals?deal=${deal.id}`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={async () => {
                  await deleteEntity(deal.id, `Delete "${deal.title}"?`)
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
  ], [deleteEntity])

  // ── Bulk actions ──────────────────────────────────────────
  const [_bulkBusy, setBulkBusy] = useState(false)
  const [customFields, setCustomFields] = useState<{ fieldKey: string; fieldLabel: string }[]>([])
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/tenant/custom-fields?entityType=deal', { signal: abort.signal })
      .then(r => r.ok ? r.json() : { fields: [] })
      .then(d => { if (!abort.signal.aborted) setCustomFields(d.fields ?? []); })
      .catch((err) => { if (err?.name !== 'AbortError') console.warn('[deals-data-table] Failed to load custom fields:', err); });
    return () => abort.abort();
  }, [])

  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/tenant/segments?entity_type=deal', { signal: abort.signal })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => { if (!abort.signal.aborted) setSegments(d.data ?? []); })
      .catch((err) => { if (err?.name !== 'AbortError') console.warn('[deals-data-table] Failed to load segments:', err); });
    return () => abort.abort();
  }, [])
  const callBulk = useCallback(async (action: string, ids: string[], payload: Record<string, unknown> = {}, isSelectAll = false) => {
    setBulkBusy(true)
    try {
      const body = isSelectAll
        ? (() => {
            const filters: Record<string, string> = {};
            if (globalFilter) filters.q = globalFilter;
            return { action, selectAll: true, filters, ...(Object.keys(payload).length ? { payload } : {}) };
          })()
        : { action, deal_ids: ids, ...(Object.keys(payload).length ? { payload } : {}) };
      const res = await fetch('/api/tenant/deals/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${data.action}: ${data.affected} deal(s)`)
        loadData(pagination.pageIndex)
      } else {
        toast.error(data.error || `Failed to ${action} deals`)
      }
    } finally {
      setBulkBusy(false)
    }
  }, [loadData, pagination.pageIndex, globalFilter])

  const bulkActions = useMemo(() => {
    return [
    {
      id: 'assign',
      label: 'Assign',
      icon: <UserPlus className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: teamMembers.map((m) => ({ value: m.user_id, label: m.full_name })),
      onClick: async (ids: string[], input?: string, isSelectAllMatching?: boolean) => {
        if (!input) return toast.error('Pick a teammate')
        await callBulk('assign', ids, { assigned_to: input }, isSelectAllMatching)
      },
    },
    {
      id: 'transfer',
      label: 'Transfer',
      icon: <ArrowRightLeft className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: teamMembers.map((m) => ({ value: m.user_id, label: m.full_name })),
      onClick: async (ids: string[], input?: string, isSelectAllMatching?: boolean) => {
        if (!input) return toast.error('Pick a teammate')
        await callBulk('transfer', ids, { assigned_to: input }, isSelectAllMatching)
      },
    },
    {
      id: 'stage',
      label: 'Move Stage',
      icon: <Layers className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: stages.map(s => ({
        value: s.id,
        label: stages.filter(x => x.pipeline === s.pipeline).length > 1 ? `${s.pipeline} → ${s.name}` : s.name,
      })),
      onClick: async (ids: string[], input?: string, isSelectAllMatching?: boolean) => {
        if (!input) return toast.error('Pick a stage')
        await callBulk('stage', ids, { stage_id: input }, isSelectAllMatching)
      },
    },
    {
      id: 'tag',
      label: 'Add Tag',
      icon: <Tag className="w-3.5 h-3.5" />,
      requiresInput: true,
      inputPlaceholder: 'Tag name',
      onClick: async (ids: string[], input?: string, isSelectAllMatching?: boolean) => {
        if (!input?.trim()) return toast.error('Tag name required')
        await callBulk('tag', ids, { tag: input.trim() }, isSelectAllMatching)
      },
    },
    {
      id: 'close',
      label: 'Close (Won/Lost)',
      icon: <Trophy className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: stages
        .filter(s => /won|lost|closed/i.test(s.name))
        .map(s => ({ value: s.id, label: `${s.pipeline} → ${s.name}` })),
      onClick: async (ids: string[], input?: string, isSelectAllMatching?: boolean) => {
        if (!input) return toast.error('Pick a close stage (Won / Lost)')
        const reason = window.prompt('Close reason (optional)') ?? null
        const stage = stages.find(s => s.id === input)
        const outcome = stage && (/lost/i.test(stage.name) ? 'lost' : /won/i.test(stage.name) ? 'won' : undefined)
        await callBulk('close', ids, { stage_id: input, reason, outcome }, isSelectAllMatching)
      },
    },
    {
      id: 'update_field',
      label: 'Update Field',
      icon: <Tag className="w-3.5 h-3.5" />,
      requiresSelect: true,
      selectOptions: customFields.map(f => ({ value: f.fieldKey, label: f.fieldLabel })),
      onClick: async (ids: string[], fieldKey?: string, isSelectAllMatching?: boolean) => {
        if (!fieldKey) return toast.error('Select a field')
        const field = customFields.find(f => f.fieldKey === fieldKey)
        const value = window.prompt(`Enter value for "${field?.fieldLabel || fieldKey}":`)
        if (value === null) return
        await callBulk('update_field', ids, { field_key: fieldKey, field_value: value }, isSelectAllMatching)
      },
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: <Archive className="w-3.5 h-3.5" />,
      requiresConfirmation: true,
      confirmationMessage: 'Archive the selected deals? They will be hidden from active views.',
      onClick: async (ids: string[], _input?: string, isSelectAllMatching?: boolean) => {
        await callBulk('archive', ids, {}, isSelectAllMatching)
      },
    },
    {
      id: 'restore',
      label: 'Restore',
      icon: <RotateCcw className="w-3.5 h-3.5" />,
      requiresConfirmation: true,
      confirmationMessage: 'Restore the selected deals from archive?',
      onClick: async (ids: string[], _input?: string, isSelectAllMatching?: boolean) => {
        await callBulk('restore', ids, {}, isSelectAllMatching)
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      requiresConfirmation: true,
      confirmationMessage: 'Soft-delete the selected deals? They can be restored from Trash.',
      onClick: async (ids: string[], _input?: string, isSelectAllMatching?: boolean) => {
        await callBulk('delete', ids, {}, isSelectAllMatching)
      },
    },
    ...(segments.length > 0 ? [{
      id: 'add_to_segment',
      label: 'Add to Segment',
      requiresSelect: true,
      selectOptions: segments.map(s => ({ value: s.id, label: s.name })),
      onClick: async (ids: string[], input?: string, isSelectAllMatching?: boolean) => {
        if (!input) return toast.error('Select a segment')
        await callBulk('add_to_segment', ids, { segment_id: input }, isSelectAllMatching)
      },
    }] : []),
  ];
  }, [teamMembers, stages, callBulk, customFields, segments])

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Deals</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} total</p>
        </div>
        {permissions.canCreate && (
          <Button onClick={() => setShowAdd(!showAdd)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Deal
          </Button>
        )}
      </div>

      {/* Add Deal Form */}
      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="font-semibold">New Deal</h3>
          <form onSubmit={addDeal} className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-bold text-foreground/80 mb-1">Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                required
                className={inp}
                placeholder="e.g., Enterprise Deal - Acme Inc"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Value *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                required
                className={inp}
                placeholder="50000"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Stage</label>
              <select
                value={form.stage_name}
                onChange={(e) => setForm(f => ({ ...f, stage_name: e.target.value }))}
                className={inp}
              >
                {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Close Date</label>
              <input
                type="date"
                value={form.close_date}
                onChange={(e) => setForm(f => ({ ...f, close_date: e.target.value }))}
                className={inp}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Contact</label>
              <div className="flex items-center gap-1">
                <select
                  value={form.contact_id}
                  onChange={(e) => setForm(f => ({ ...f, contact_id: e.target.value }))}
                  className={inp + " flex-1"}
                >
                  <option value="">No contact</option>
                  {(contactList || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                  ))}
                </select>
                <InlineContactCreate
                  onCreated={(newContact) => {
                    setContactList(prev => [...prev, newContact])
                    setForm(f => ({ ...f, contact_id: newContact.id }))
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Company</label>
              <div className="flex items-center gap-1">
                <select
                  value={form.company_id}
                  onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))}
                  className={inp + " flex-1"}
                >
                  <option value="">No company</option>
                  {(companyList || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <InlineCompanyCreate
                  onCreated={(newCompany) => {
                    setCompanyList(prev => [...prev, newCompany])
                    setForm(f => ({ ...f, company_id: newCompany.id }))
                  }}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Assigned To</label>
              <select
                value={form.assigned_to}
                onChange={(e) => setForm(f => ({ ...f, assigned_to: e.target.value }))}
                className={inp}
              >
                <option value="">Unassigned</option>
                {(teamMembers || []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-bold text-foreground/80 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                className={inp}
                rows={2}
                placeholder="Deal details, notes, etc."
              />
            </div>
            <div className="col-span-2 flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Deal'}</Button>
            </div>
          </form>
        </div>
      )}

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={deals}
        total={total}
        loading={loading}
        pageSize={pagination.pageSize}
        onPageSizeChange={handlePageSizeChange}
        globalFilter={globalFilter}
        onGlobalFilterChange={handleGlobalFilterChange}
        enableRowSelection
        enableBulkActions
        bulkActions={bulkActions}
        matchingCount={total}
        selectAllMatching={selectAllMatching}
        onSelectAllMatching={setSelectAllMatching}
        searchPlaceholder="Search deals by title, contact, or company..."
        manualPagination
        pageIndex={pagination.pageIndex}
        onPaginationChange={handlePaginationChange}
        emptyState={{
          icon: <DollarSign className="w-6 h-6 text-muted-foreground" />,
          title: "No deals yet",
          description: "Start tracking your sales pipeline by adding your first deal",
          action: permissions.canCreate ? {
            label: "Add Deal",
            onClick: () => setShowAdd(true),
            icon: <Plus className="w-4 h-4 mr-2" />,
          } : undefined,
        }}
      />
    </div>
  )
}
