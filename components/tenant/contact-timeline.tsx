"use client"

import { useState, useEffect, useCallback } from 'react'
import { 
  Activity, 
  Mail, 
  Phone, 
  Calendar, 
  FileText, 
  CheckCircle, 
  TrendingUp,
  User,
  Clock,
  AlertCircle,
  MailOpen,
  Link as LinkIcon,
  FormInput as FormSubmit,
  Zap,
  MoreHorizontal,
  ChevronDown,
  Filter,
} from 'lucide-react'
import { cn, formatRelativeTime, formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const EVENT_TYPE_CONFIG: Record<string, {
  icon: React.ComponentType<{ className?: string }>
  color: string
  bg: string
  label: string
}> = {
  // Contact events
  contact_created: { icon: User, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Contact created' },
  contact_updated: { icon: User, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Contact updated' },
  contact_status_changed: { icon: TrendingUp, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20', label: 'Status changed' },
  contact_assigned: { icon: User, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Contact assigned' },
  contact_merged: { icon: User, color: 'text-slate-600', bg: 'bg-slate-50 dark:bg-slate-900/20', label: 'Contact merged' },
  
  // Email events
  email_sent: { icon: Mail, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Email sent' },
  email_opened: { icon: MailOpen, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Email opened' },
  email_clicked: { icon: LinkIcon, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Link clicked' },
  email_replied: { icon: Mail, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Email replied' },
  email_bounced: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Email bounced' },
  
  // Call events
  call_made: { icon: Phone, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20', label: 'Call made' },
  call_scheduled: { icon: Phone, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20', label: 'Call scheduled' },
  call_completed: { icon: Phone, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Call completed' },
  call_no_show: { icon: Phone, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Call no-show' },
  
  // Meeting events
  meeting_scheduled: { icon: Calendar, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Meeting scheduled' },
  meeting_completed: { icon: Calendar, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Meeting completed' },
  meeting_no_show: { icon: Calendar, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Meeting no-show' },
  meeting_cancelled: { icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Meeting cancelled' },
  
  // Note events
  note_added: { icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50 dark:bg-slate-900/20', label: 'Note added' },
  
  // Task events
  task_created: { icon: CheckCircle, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Task created' },
  task_completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Task completed' },
  task_overdue: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Task overdue' },
  
  // Deal events
  deal_created: { icon: TrendingUp, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20', label: 'Deal created' },
  deal_updated: { icon: TrendingUp, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20', label: 'Deal updated' },
  deal_stage_changed: { icon: TrendingUp, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Deal stage changed' },
  deal_won: { icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Deal won' },
  deal_lost: { icon: TrendingUp, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20', label: 'Deal lost' },
  
  // Lifecycle events
  lifecycle_stage_changed: { icon: TrendingUp, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-900/20', label: 'Lifecycle changed' },
  
  // Form events
  form_submitted: { icon: FormSubmit, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', label: 'Form submitted' },
  
  // Automation events
  automation_triggered: { icon: Zap, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20', label: 'Automation triggered' },
  
  // Webhook events
  webhook_sent: { icon: Zap, color: 'text-slate-600', bg: 'bg-slate-50 dark:bg-slate-900/20', label: 'Webhook sent' },
}

interface TimelineEvent {
  id: string
  event_type: string
  description: string
  metadata: any
  created_at: string
  user_name: string | null
  user_email: string | null
  user_avatar: string | null
}

interface ContactTimelineProps {
  contactId: string
  limit?: number
  compact?: boolean
}

export function ContactTimeline({ contactId, limit = 50, compact = false }: ContactTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)

  const loadTimeline = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (filter !== 'all') {
        params.set('event_type', filter)
      }
      const res = await fetch(`/api/tenant/contacts/${contactId}/timeline?${params}`)
      const data = await res.json()
      setEvents(data.data || [])
    } catch (error) {
      console.error('Failed to load timeline:', error)
    }
    setLoading(false)
  }, [contactId, limit, filter])

  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  // Get unique event types for filter
  const eventTypes = Array.from(new Set(events.map(e => e.event_type)))

  // Group events by date
  const groupedEvents = events.reduce((acc, event) => {
    const date = new Date(event.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    if (!acc[date]) {
      acc[date] = []
    }
    acc[date].push(event)
    return acc
  }, {} as Record<string, TimelineEvent[]>)

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <Activity className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-sm font-medium">No activity yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Activity will appear here as you interact with this contact
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter */}
      {!compact && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Filter className="w-4 h-4" />
            <span>Filter:</span>
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm rounded-lg border border-border bg-background px-2 py-1 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="all">All Events</option>
            {eventTypes.map(type => (
              <option key={type} value={type}>
                {EVENT_TYPE_CONFIG[type]?.label || type}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

        {/* Events grouped by date */}
        {Object.entries(groupedEvents).map(([date, dateEvents]) => (
          <div key={date} className="mb-6">
            {/* Date header */}
            <div className="relative pl-10 mb-3">
              <span className="text-xs font-semibold text-muted-foreground bg-background px-2 py-0.5 rounded">
                {date}
              </span>
            </div>

            {/* Events */}
            <div className="space-y-3">
              {dateEvents.map((event) => {
                const config = EVENT_TYPE_CONFIG[event.event_type] || {
                  icon: Activity,
                  color: 'text-slate-600',
                  bg: 'bg-slate-50 dark:bg-slate-900/20',
                  label: event.event_type,
                }
                const Icon = config.icon
                const isExpanded = expandedEvent === event.id

                return (
                  <div key={event.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div className={cn(
                      'absolute left-2 w-5 h-5 rounded-full border-2 border-background shrink-0 flex items-center justify-center',
                      config.bg
                    )}>
                      <Icon className={cn('w-3 h-3', config.color)} />
                    </div>

                    {/* Event card */}
                    <div className={cn(
                      'rounded-lg border bg-card p-3 transition-all',
                      isExpanded ? 'border-violet-300 dark:border-violet-700' : 'border-border hover:border-violet-200 dark:hover:border-violet-800'
                    )}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{config.label}</span>
                            {event.metadata?.stage && (
                              <Badge variant="outline" className="text-xs">
                                {event.metadata.stage}
                              </Badge>
                            )}
                          </div>
                          {event.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {event.description}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(event.created_at)}
                            </span>
                            {event.user_name && (
                              <>
                                <span className="text-xs text-muted-foreground">·</span>
                                <span className="text-xs text-muted-foreground">
                                  {event.user_name}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setExpandedEvent(isExpanded ? null : event.id)}>
                                {isExpanded ? 'Hide' : 'Show'} details
                              </DropdownMenuItem>
                              {event.metadata?.metadata && (
                                <DropdownMenuItem>
                                  View metadata
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      {/* Expanded metadata */}
                      {isExpanded && event.metadata && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-xs font-semibold text-muted-foreground mb-2">Metadata:</p>
                          <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-48">
                            {JSON.stringify(event.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Load more */}
      {!compact && events.length >= limit && (
        <div className="text-center pt-4">
          <Button variant="outline" size="sm" onClick={loadTimeline}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
