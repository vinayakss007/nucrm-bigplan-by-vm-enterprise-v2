import { db } from '@/drizzle/db';
import { dashboardLayouts } from '@/drizzle/schema/dashboard';
import { eq, and, desc } from 'drizzle-orm';
import { getWidgetsForPlan } from '@/components/tenant/dashboard/widget-registry';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';
import type { DashboardLayout, DashboardLayoutItem, LayoutSource } from '@/types/dashboard';

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

export async function getSavedLayout(
  tenantId: string,
  userId: string,
): Promise<{ layout: DashboardLayout; source: LayoutSource } | null> {
  const row = await db.query.dashboardLayouts.findFirst({
    where: and(
      eq(dashboardLayouts.tenantId, tenantId),
      eq(dashboardLayouts.userId, userId),
      eq(dashboardLayouts.isDefault, true),
    ),
    orderBy: desc(dashboardLayouts.updatedAt),
  });
  if (row?.layout) {
    return { layout: row.layout as DashboardLayout, source: row.source as LayoutSource };
  }

  const tenantRow = await db.query.dashboardLayouts.findFirst({
    where: and(
      eq(dashboardLayouts.tenantId, tenantId),
      eq(dashboardLayouts.userId, null as any),
      eq(dashboardLayouts.isDefault, true),
    ),
    orderBy: desc(dashboardLayouts.updatedAt),
  });
  if (tenantRow?.layout) {
    return { layout: tenantRow.layout as DashboardLayout, source: tenantRow.source as LayoutSource };
  }

  return null;
}

export async function saveLayout(
  tenantId: string,
  userId: string,
  layout: DashboardLayout,
  source: LayoutSource = 'user',
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(dashboardLayouts)
      .set({ isDefault: false })
      .where(and(
        eq(dashboardLayouts.tenantId, tenantId),
        eq(dashboardLayouts.userId, userId),
        eq(dashboardLayouts.isDefault, true),
      ));

    const existing = await tx.query.dashboardLayouts.findFirst({
      where: and(
        eq(dashboardLayouts.tenantId, tenantId),
        eq(dashboardLayouts.userId, userId),
        eq(dashboardLayouts.isDefault, true),
      ),
    });

    if (existing) {
      await tx.update(dashboardLayouts)
        .set({ layout, updatedAt: new Date() })
        .where(eq(dashboardLayouts.id, existing.id));
    } else {
      await tx.insert(dashboardLayouts).values({
        tenantId,
        userId,
        name: 'Default',
        layout,
        isDefault: true,
        source,
      });
    }
  });
}

export async function resolveDashboardLayout(
  tenantId: string,
  userId: string,
  planName: string,
  industryId?: string | null,
): Promise<{ layout: DashboardLayout; source: LayoutSource }> {
  const saved = await getSavedLayout(tenantId, userId);
  if (saved) return saved;

  if (industryId) {
    const industry = getIndustryDefaultLayout(industryId);
    if (industry) {
      return { layout: industry, source: 'industry' };
    }
  }

  return { layout: getPlanDefaultLayout(planName), source: 'plan' };
}
