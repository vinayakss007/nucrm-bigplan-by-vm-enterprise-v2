import { getWidgetsForPlan } from '@/components/tenant/dashboard/widget-registry';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import type { DashboardLayout } from '@/types/dashboard';

const PLAN_DEFAULT_LAYOUT_CACHE = new Map<string, DashboardLayout>();

export function getPlanDefaultLayout(planName: string): DashboardLayout {
  const key = planName.toLowerCase();
  const cached = PLAN_DEFAULT_LAYOUT_CACHE.get(key);
  if (cached) return cached;

  const widgets = getWidgetsForPlan(key);
  const layout: DashboardLayout = widgets.map((w, i) => ({
    widget: w.id,
    position: i,
    size: w.defaultSize,
  }));
  PLAN_DEFAULT_LAYOUT_CACHE.set(key, layout);
  return layout;
}

export function getIndustryDefaultLayout(industryId: string): DashboardLayout | null {
  const template = INDUSTRY_TEMPLATES[industryId];
  if (!template?.defaultDashboardLayout) return null;
  return template.defaultDashboardLayout as DashboardLayout;
}
