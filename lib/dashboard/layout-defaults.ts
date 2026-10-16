/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { getWidgetsForPlan } from '@/components/tenant/dashboard/widget-registry';
import type { DashboardLayout } from '@/types/dashboard';

const PLAN_DEFAULT_LAYOUT_CACHE = new Map<string, DashboardLayout>();
const ROLE_DEFAULT_LAYOUT_CACHE = new Map<string, DashboardLayout>();

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

// #2633: the industry default layout is resolved from product_templates (the
// DB single source of truth) — see getIndustryDefaultLayout in layout-resolver.ts.
// It lives there, not here, because this module is imported by the client
// dashboard (dashboard-client.tsx) and must stay free of the Node-only DB layer
// (drizzle → request-connection → async_hooks) that Turbopack cannot bundle.

/**
 * Static role → widget map for role-first dashboard defaults (quick-win #6).
 * Unknown roles fall back to the plan-based layout (getPlanDefaultLayout) so
 * the resolver stays safe when new roles are added.
 */
const ROLE_WIDGETS: Record<string, string[]> = {
  // Leadership/ops: pipeline, revenue, team activity, tickets.
  admin: ['stats-revenue', 'stats-pipeline', 'activity-feed', 'invoices-widget', 'leads-pipeline', 'tickets-widget'],
  // Sales reps: own pipeline, closing soon, my tasks, recent contacts.
  sales_rep: ['stats-pipeline', 'deals-closing', 'tasks-list', 'contacts-recent', 'stats-tasks', 'stats-contacts'],
  // Support agents: tickets first, then activity + recent contacts.
  support_agent: ['tickets-widget', 'activity-feed', 'stats-tasks', 'contacts-recent'],
  // Managers: revenue + pipeline + follow-ups visibility.
  manager: ['stats-revenue', 'stats-pipeline', 'leads-pipeline', 'follow-ups-list', 'activity-feed', 'invoices-widget'],
};

export function getRoleDefaultLayout(roleSlug: string): DashboardLayout | null {
  const role = (roleSlug || '').toLowerCase();
  const widgetIds = ROLE_WIDGETS[role];
  if (!widgetIds) return null;

  const cached = ROLE_DEFAULT_LAYOUT_CACHE.get(role);
  if (cached) return cached;

  const layout: DashboardLayout = widgetIds.map((widget, i) => ({
    widget,
    position: i,
    size: '1x1',
  }));
  ROLE_DEFAULT_LAYOUT_CACHE.set(role, layout);
  return layout;
}
