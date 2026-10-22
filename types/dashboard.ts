export interface DashboardLayoutItem {
  widget: string
  position: number
  size: '1x1' | '2x1' | '1x2' | '2x2'
  config?: Record<string, unknown>
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
  config?: Record<string, unknown>
}

export interface DashboardDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
  stale: boolean
  /**
   * When `data` was last successfully read, in epoch milliseconds — the same value
   * the hook writes into its `sessionStorage` entry, so a payload and its read time
   * come from one clock reading instead of two.
   *
   * #2872: a tile still holding a payload whose refresh was refused has to say how
   * old that payload is, and `Date.now()` at render is not that number — it would
   * date the caveat, not the read. `null` means nothing has landed yet.
   */
  lastUpdatedAt: number | null
}

export type LayoutSource = 'user' | 'admin' | 'industry' | 'plan' | 'role'

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
