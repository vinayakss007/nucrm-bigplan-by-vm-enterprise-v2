export interface DashboardLayoutItem {
  widget: string
  position: number
  size: '1x1' | '2x1' | '1x2' | '2x2'
  config?: Record<string, any>
}

export type DashboardLayout = DashboardLayoutItem[]

export interface WidgetConfig {
  id: string
  name: string
  description: string
  category: 'core' | 'leads' | 'deals' | 'revenue' | 'support' | 'ai' | 'activity' | 'projects' | 'automation'
  defaultSize: '1x1' | '2x1' | '1x2' | '2x2'
  minPlan: string
  refreshInterval: number
  apiEndpoint: string
  adminOnly?: boolean
}

export interface WidgetProps {
  data: any
  tenantId: string
  userId: string
  isAdmin: boolean
  config?: Record<string, any>
}

export interface DashboardDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
  stale: boolean
}
