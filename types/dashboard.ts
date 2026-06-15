export interface DashboardLayoutItem {
  widget: string
  position: number
  size: '1x1' | '2x1' | '1x2' | '2x2'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  tenantId: string
  userId: string
  isAdmin: boolean
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: Record<string, any>
}

export interface DashboardDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
  stale: boolean
}

export type LayoutSource = 'user' | 'admin' | 'industry' | 'plan'

export interface SavedDashboardLayout {
  id: string
  tenantId: string
  userId: string | null
  name: string
  layout: DashboardLayout
  isDefault: boolean
  source: LayoutSource
  createdAt: string
  updatedAt: string
}
