import { db } from '@/drizzle/db';
import { dashboardLayouts } from '@/drizzle/schema/dashboard';
import { eq, and, desc } from 'drizzle-orm';
import { getPlanDefaultLayout, getIndustryDefaultLayout } from '@/lib/dashboard/layout-defaults';
import type { DashboardLayout, DashboardLayoutItem, LayoutSource } from '@/types/dashboard';

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
