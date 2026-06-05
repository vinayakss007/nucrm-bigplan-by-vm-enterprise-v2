import type { WidgetConfig } from '@/types/dashboard'

const PLAN_ORDER = ['free', 'starter', 'pro', 'enterprise'] as const

const WIDGET_REGISTRY: Record<string, WidgetConfig> = {
  'stats-contacts': {
    id: 'stats-contacts', name: 'Contacts Overview',
    description: 'Total contacts and new this month',
    category: 'core', defaultSize: '1x1', minPlan: 'free',
    refreshInterval: 300, apiEndpoint: '/api/tenant/dashboard/widgets/stats/contacts',
  },
  'stats-pipeline': {
    id: 'stats-pipeline', name: 'Pipeline Value',
    description: 'Total pipeline value and active deals',
    category: 'core', defaultSize: '1x1', minPlan: 'free',
    refreshInterval: 300, apiEndpoint: '/api/tenant/dashboard/widgets/stats/pipeline',
  },
  'stats-revenue': {
    id: 'stats-revenue', name: 'Revenue MTD',
    description: 'Revenue closed this month',
    category: 'core', defaultSize: '1x1', minPlan: 'free',
    refreshInterval: 300, apiEndpoint: '/api/tenant/dashboard/widgets/stats/revenue',
  },
  'stats-tasks': {
    id: 'stats-tasks', name: 'Tasks Due',
    description: 'Tasks due today and overdue',
    category: 'core', defaultSize: '1x1', minPlan: 'free',
    refreshInterval: 120, apiEndpoint: '/api/tenant/dashboard/widgets/stats/tasks',
  },
  'activity-feed': {
    id: 'activity-feed', name: 'Recent Activity',
    description: 'Latest team activity',
    category: 'activity', defaultSize: '2x1', minPlan: 'free',
    refreshInterval: 60, apiEndpoint: '/api/tenant/dashboard/widgets/activity',
  },
  'tasks-list': {
    id: 'tasks-list', name: 'My Tasks',
    description: 'Open and overdue tasks',
    category: 'activity', defaultSize: '1x1', minPlan: 'free',
    refreshInterval: 120, apiEndpoint: '/api/tenant/dashboard/widgets/tasks',
  },
  'deals-closing': {
    id: 'deals-closing', name: 'Closing Soon',
    description: 'Deals closing soon',
    category: 'deals', defaultSize: '1x1', minPlan: 'free',
    refreshInterval: 300, apiEndpoint: '/api/tenant/dashboard/widgets/deals/closing',
  },
  'contacts-recent': {
    id: 'contacts-recent', name: 'Recent Contacts',
    description: 'Recently added contacts',
    category: 'core', defaultSize: '1x1', minPlan: 'free',
    refreshInterval: 300, apiEndpoint: '/api/tenant/dashboard/widgets/contacts/recent',
  },
  'leads-pipeline': {
    id: 'leads-pipeline', name: 'Leads Pipeline',
    description: 'Lead status breakdown and totals',
    category: 'leads', defaultSize: '1x1', minPlan: 'starter',
    refreshInterval: 300, apiEndpoint: '/api/tenant/dashboard/widgets/leads',
  },
  'tickets-widget': {
    id: 'tickets-widget', name: 'Support Tickets',
    description: 'Open, in-progress, and resolved tickets',
    category: 'support', defaultSize: '1x1', minPlan: 'starter',
    refreshInterval: 120, apiEndpoint: '/api/tenant/dashboard/widgets/tickets',
  },
  'invoices-widget': {
    id: 'invoices-widget', name: 'Invoices',
    description: 'Invoice status and outstanding totals',
    category: 'revenue', defaultSize: '1x1', minPlan: 'starter',
    refreshInterval: 300, apiEndpoint: '/api/tenant/dashboard/widgets/invoices',
  },
}

export function getWidget(id: string): WidgetConfig | undefined {
  return WIDGET_REGISTRY[id]
}

export function getWidgetsForPlan(planId: string): WidgetConfig[] {
  const planIndex = PLAN_ORDER.indexOf(planId as typeof PLAN_ORDER[number])
  if (planIndex === -1) return Object.values(WIDGET_REGISTRY).filter(w => w.minPlan === 'free')
  return Object.values(WIDGET_REGISTRY).filter(w => {
    const idx = PLAN_ORDER.indexOf(w.minPlan as typeof PLAN_ORDER[number])
    return idx !== -1 && idx <= planIndex
  })
}

export function getAllWidgets(): WidgetConfig[] {
  return Object.values(WIDGET_REGISTRY)
}

export function getWidgetsForLayout(layout: Array<{ widget: string }>): WidgetConfig[] {
  return layout.map(item => WIDGET_REGISTRY[item.widget]).filter((w): w is WidgetConfig => w !== undefined)
}

export { WIDGET_REGISTRY }
