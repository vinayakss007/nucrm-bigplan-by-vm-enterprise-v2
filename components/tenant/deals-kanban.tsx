"use client"

import { useState, useCallback, useMemo, useRef } from 'react'
import { Plus, MoreHorizontal, Edit, User, Building, Calendar, GripVertical, Trash2 } from 'lucide-react'
import { cn, formatCurrency, formatDate, toSnakeCase } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import toast from 'react-hot-toast'

// Stage color mapping
const STAGE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  'Lead': { border: 'border-slate-300 dark:border-slate-600', bg: 'bg-slate-50 dark:bg-slate-900/50', text: 'text-slate-700 dark:text-slate-300' },
  'Qualified': { border: 'border-blue-300 dark:border-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300' },
  'Proposal': { border: 'border-violet-300 dark:border-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20', text: 'text-violet-700 dark:text-violet-300' },
  'Negotiation': { border: 'border-amber-300 dark:border-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300' },
  'Won': { border: 'border-emerald-300 dark:border-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300' },
  'Lost': { border: 'border-red-300 dark:border-red-600', bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300' },
}

interface Deal {
  id: string
  title: string
  amount: string | number
  stageId: string
  stage_name: string | null
  close_date: string | null
  contact_id: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  assigned_to: string | null
  created_at: string
}

interface Stage {
  id: string
  name: string
  order: number
  pipelineId: string
}

interface Contact {
  id: string
  first_name: string
  last_name: string
}

interface Company {
  id: string
  name: string
}

interface TeamMember {
  user_id: string
  full_name: string
}

interface Props {
  initialDeals: Deal[]
  stages: Stage[]
  contacts: Contact[]
  companies: Company[]
  teamMembers: TeamMember[]
  permissions: { canCreate: boolean; canEdit: boolean; canDelete: boolean }
}

export default function DealsKanban({ initialDeals, stages, contacts, companies, teamMembers, permissions }: Props) {
  const [deals, setDeals] = useState(initialDeals)
  const [showAdd, setShowAdd] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    amount: '',
    stage: stages[0]?.name?.toLowerCase() || 'lead',
    contact_id: '',
    company_id: '',
    assigned_to: '',
    close_date: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)

  // Touch drag state for mobile
  const [touchDragging, setTouchDragging] = useState<string | null>(null)
  const [_touchDragPos, setTouchDragPos] = useState<{ x: number; y: number } | null>(null)
  const [touchOverStage, setTouchOverStage] = useState<string | null>(null)
  const [showMobileStagePicker, setShowMobileStagePicker] = useState<{ dealId: string; dealTitle: string } | null>(null)
  const kanbanScrollRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const touchDealRef = useRef<string | null>(null)

  // Group deals by stage name (from the join)
  const groupedByStage = useMemo(() => {
    return stages.map(stage => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      deals: deals.filter((d) => d.stageId === stage.id),
      totalValue: deals.filter((d) => d.stageId === stage.id).reduce((sum: number, d) => sum + Number(d.amount || 0), 0),
    }))
  }, [stages, deals])

  const addDeal = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/tenant/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          amount: Number(form.amount) || 0,
          stage: form.stage, // Send stage name - API will convert to stage_id
          contact_id: form.contact_id || null,
          company_id: form.company_id || null,
          assigned_to: form.assigned_to || null,
          close_date: form.close_date || null,
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
      setForm({ title: '', amount: '', stage: stages[0]?.name?.toLowerCase() || 'lead', contact_id: '', company_id: '', assigned_to: '', close_date: '', description: '' })
      // Refresh by fetching again
      const refreshRes = await fetch('/api/tenant/deals?limit=200')
      const refreshData = await refreshRes.json()
      setDeals((refreshData.data ?? []).map((d: Record<string, unknown>) => toSnakeCase(d)))
    } catch {
      toast.error('Failed to create deal')
    }
    setSaving(false)
  }

  const updateDealStage = useCallback(async (dealId: string, newStageName: string) => {
    try {
      const res = await fetch(`/api/tenant/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStageName }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to update deal stage')
        return
      }
      // Optimistic update - update stageId to match the new stage
      const newStage = stages.find(s => s.name.toLowerCase() === newStageName.toLowerCase())
      setDeals((prev) => prev.map((d) => d.id === dealId ? { ...d, stageId: newStage?.id ?? '', stage_name: newStage?.name ?? null } : d))
      toast.success(`Deal moved to ${newStageName}`)
    } catch {
      toast.error('Failed to update deal stage')
    }
  }, [stages])

  const deleteDeal = useCallback(async (dealId: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return
    try {
      const res = await fetch(`/api/tenant/deals/${dealId}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Deal deleted')
        setDeals((prev) => prev.filter((d) => d.id !== dealId))
      } else {
        toast.error('Failed to delete')
      }
    } catch {
      toast.error('Failed to delete deal')
    }
  }, [])

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, dealId: string) => {
    setDraggingId(dealId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverStage !== stageId) {
      setDragOverStage(stageId)
    }
  }

  const handleDragLeave = (_e: React.DragEvent) => {
    setDragOverStage(null)
  }

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault()
    setDragOverStage(null)
    if (draggingId) {
      await updateDealStage(draggingId, stageId)
      setDraggingId(null)
    }
  }

  const handleTouchDealStart = (e: React.TouchEvent, dealId: string) => {
    touchStartRef.current = { x: e.touches[0]?.clientX ?? 0, y: e.touches[0]?.clientY ?? 0 }
    touchDealRef.current = dealId
    setTouchDragging(dealId)
  }

  const handleTouchDealMove = (e: React.TouchEvent) => {
    if (!touchDragging || !touchStartRef.current) return
    const dx = (e.touches[0]?.clientX ?? 0) - touchStartRef.current.x
    const dy = (e.touches[0]?.clientY ?? 0) - touchStartRef.current.y
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
    setTouchDragPos({ x: e.touches[0]?.clientX ?? 0, y: e.touches[0]?.clientY ?? 0 })

    if (kanbanScrollRef.current) {
      const container = kanbanScrollRef.current
      const rect = container.getBoundingClientRect()
      const scrollLeft = container.scrollLeft
      const stageWidth = rect.width / Math.min(stages.length, 3)
      const stageIndex = Math.floor(((e.touches[0]?.clientX ?? 0) - rect.left + scrollLeft) / stageWidth)
      const clampedIndex = Math.max(0, Math.min(stages.length - 1, stageIndex))
      setTouchOverStage(stages[clampedIndex]?.id ?? null)
    }
  }

  const handleTouchDealEnd = () => {
    if (touchDragging && touchOverStage) {
      const targetStage = stages.find(s => s.id === touchOverStage)
      if (targetStage) {
        updateDealStage(touchDragging, targetStage.name.toLowerCase())
      }
    }
    setTouchDragging(null)
    setTouchDragPos(null)
    setTouchOverStage(null)
    touchStartRef.current = null
    touchDealRef.current = null
  }

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Deals Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            {deals.length} deals · {formatCurrency(deals.reduce((sum: number, d) => sum + Number(d.amount || 0), 0))} total value
          </p>
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
              <label className="block text-xs font-medium text-muted-foreground mb-1">Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                required
                className={inp}
                placeholder="e.g., Enterprise Deal - Acme Inc"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Amount *</label>
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
              <label className="block text-xs font-medium text-muted-foreground mb-1">Stage</label>
              <select
                value={form.stage}
                onChange={(e) => setForm(f => ({ ...f, stage: e.target.value }))}
                className={inp}
              >
                {stages.map((s) => <option key={s.id} value={s.name.toLowerCase()}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Close Date</label>
              <input
                type="date"
                value={form.close_date}
                onChange={(e) => setForm(f => ({ ...f, close_date: e.target.value }))}
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
                {(contacts || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Company</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm(f => ({ ...f, company_id: e.target.value }))}
                className={inp}
              >
                <option value="">No company</option>
                {(companies || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
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
                {(teamMembers || []).map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.full_name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
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

      {/* Kanban Board */}
      {/* Mobile: horizontal scrollable stages */}
      <div ref={kanbanScrollRef} className="flex gap-3 overflow-x-auto pb-4 md:hidden snap-x snap-mandatory scrollbar-thin">
        {groupedByStage.map((stage) => {
          const colors = STAGE_COLORS[stage.name] ?? STAGE_COLORS['Lead']!
          return (
            <div
              key={stage.id}
              className={cn(
                'rounded-xl border-2 border-dashed p-3 min-w-[280px] min-h-[300px] transition-colors snap-center',
                colors!.bg,
                colors!.border,
                (dragOverStage === stage.id || touchOverStage === stage.id) && 'bg-violet-100 dark:bg-violet-900/30 border-violet-400'
              )}
              onDragOver={(e) => handleDragOver(e, stage.name.toLowerCase())}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.name.toLowerCase())}
            >
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className={cn("font-semibold text-sm", colors!.text)}>{stage.name}</span>
                  <Badge variant="secondary" className="text-xs">{stage.deals.length}</Badge>
                </div>
                <span className="text-xs font-medium text-muted-foreground">{formatCurrency(stage.totalValue)}</span>
              </div>

              <div className="space-y-2">
                {stage.deals.map((deal) => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, deal.id)}
                    onTouchStart={(e) => handleTouchDealStart(e, deal.id)}
                    onTouchMove={handleTouchDealMove}
                    onTouchEnd={handleTouchDealEnd}
                    className={cn(
                      'bg-card rounded-lg border border-border p-3 shadow-sm cursor-grab active:cursor-grabbing',
                      'hover:shadow-md transition-shadow group',
                      (draggingId === deal.id || touchDragging === deal.id) && 'opacity-50 ring-2 ring-violet-400'
                    )}
                    onClick={() => window.location.href = `/tenant/deals/${deal.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">{deal.title}</h4>
                        <p className="text-sm font-semibold text-violet-600 dark:text-violet-400 mt-1">
                          {formatCurrency(Number(deal.amount || 0))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <GripVertical className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity md:block hidden" />
                        <button
                          onClick={(e) => { e.stopPropagation(); setShowMobileStagePicker({ dealId: deal.id, dealTitle: deal.title }); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-accent md:hidden"
                          aria-label="Change stage"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-6 w-6 p-0 md:block hidden">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => window.location.href = `/tenant/deals/${deal.id}`}>
                              <Edit className="mr-2 h-3.5 w-3.5" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600 dark:text-red-400" onClick={() => deleteDeal(deal.id, deal.title)}>
                              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="space-y-1.5 mt-3 pt-3 border-t border-border/50">
                      {(deal.first_name || deal.last_name) && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="w-3 h-3" />
                          <span className="truncate">{deal.first_name} {deal.last_name}</span>
                        </div>
                      )}
                      {deal.company_name && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Building className="w-3 h-3" />
                          <span className="truncate">{deal.company_name}</span>
                        </div>
                      )}
                      {deal.close_date && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(deal.close_date)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {stage.deals.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground">Drop deals here</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop: grid layout */}
      <div className="hidden md:grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {groupedByStage.map((stage) => {
          const colors = STAGE_COLORS[stage.name] ?? STAGE_COLORS['Lead']!
          return (
            <div
              key={stage.id}
              className={cn(
                'rounded-xl border-2 border-dashed p-3 min-h-[400px] transition-colors',
                colors!.bg,
                colors!.border,
                dragOverStage === stage.id && 'bg-violet-100 dark:bg-violet-900/30 border-violet-400'
              )}
              onDragOver={(e) => handleDragOver(e, stage.name.toLowerCase())}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.name.toLowerCase())}
            >
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
                <div className="flex items-center gap-2">
                  <span className={cn("font-semibold text-sm", colors!.text)}>{stage.name}</span>
                  <Badge variant="secondary" className="text-xs">{stage.deals.length}</Badge>
                </div>
                <span className="text-xs font-medium text-muted-foreground">{formatCurrency(stage.totalValue)}</span>
              </div>

              <div className="space-y-2">
                {stage.deals.map((deal) => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, deal.id)}
                    className={cn(
                      'bg-card rounded-lg border border-border p-3 shadow-sm cursor-grab active:cursor-grabbing',
                      'hover:shadow-md transition-shadow group',
                      draggingId === deal.id && 'opacity-50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">{deal.title}</h4>
                        <p className="text-sm font-semibold text-violet-600 dark:text-violet-400 mt-1">
                          {formatCurrency(Number(deal.amount || 0))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <GripVertical className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-6 w-6 p-0">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => window.location.href = `/tenant/deals/${deal.id}`}>
                              <Edit className="mr-2 h-3.5 w-3.5" />Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600 dark:text-red-400" onClick={() => deleteDeal(deal.id, deal.title)}>
                              <Trash2Icon className="mr-2 h-3.5 w-3.5" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="space-y-1.5 mt-3 pt-3 border-t border-border/50">
                      {(deal.first_name || deal.last_name) && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="w-3 h-3" />
                          <span className="truncate">{deal.first_name} {deal.last_name}</span>
                        </div>
                      )}
                      {deal.company_name && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Building className="w-3 h-3" />
                          <span className="truncate">{deal.company_name}</span>
                        </div>
                      )}
                      {deal.close_date && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>{formatDate(deal.close_date)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {stage.deals.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground">Drop deals here</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Mobile stage picker bottom sheet */}
      <BottomSheet open={!!showMobileStagePicker} onOpenChange={() => setShowMobileStagePicker(null)} title="Move Deal">
        {showMobileStagePicker && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-3">Move &quot;{showMobileStagePicker.dealTitle}&quot; to:</p>
            {stages.map((stage) => {
              const colors = STAGE_COLORS[stage.name] ?? STAGE_COLORS['Lead']!
              return (
                <button
                  key={stage.id}
                  onClick={async () => {
                    await updateDealStage(showMobileStagePicker.dealId, stage.name.toLowerCase())
                    setShowMobileStagePicker(null)
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 p-4 rounded-xl border transition-colors min-h-[52px]',
                    colors!.bg,
                    colors!.border
                  )}
                >
                  <div className={cn('w-3 h-3 rounded-full', colors!.text.replace('text-', 'bg-'))} />
                  <span className="text-sm font-medium">{stage.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

function Trash2Icon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}
