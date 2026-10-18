/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { dashboardLayouts } from '@/drizzle/schema/dashboard';
import { eq, and, desc } from 'drizzle-orm';
import { getPlanDefaultLayout, getRoleDefaultLayout } from '@/lib/dashboard/layout-defaults';
import { resolveTemplate } from '@/lib/templates/resolve';
import type { DashboardLayout, LayoutSource } from '@/types/dashboard';

// #2633: industry defaults come from product_templates.default_dashboard_layout
// (superadmin-editable), with a 60s TTL cache so the dashboard resolver doesn't
// hit the DB per request. Null (unknown template / pre-0128 DB) falls through
// to role/plan defaults in resolveDashboardLayout below. This lives in the
// server-only resolver (not layout-defaults) because it depends on the DB layer.
const INDUSTRY_LAYOUT_TTL_MS = 60_000;
const INDUSTRY_LAYOUT_CACHE = new Map<string, { layout: DashboardLayout | null; expires: number }>();

export async function getIndustryDefaultLayout(industryId: string): Promise<DashboardLayout | null> {
  if (!industryId) return null;
  const hit = INDUSTRY_LAYOUT_CACHE.get(industryId);
  if (hit && hit.expires > Date.now()) return hit.layout;

  const template = await resolveTemplate(industryId).catch(() => null);
  const layout = template?.defaultDashboardLayout?.length
    ? (template.defaultDashboardLayout as unknown as DashboardLayout)
    : null;
  INDUSTRY_LAYOUT_CACHE.set(industryId, { layout, expires: Date.now() + INDUSTRY_LAYOUT_TTL_MS });
  return layout;
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
      eq(dashboardLayouts.userId, null as unknown as string),
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
  roleSlug?: string | null,
): Promise<{ layout: DashboardLayout; source: LayoutSource }> {
  const saved = await getSavedLayout(tenantId, userId);
  if (saved) return saved;

  if (industryId) {
    const industry = await getIndustryDefaultLayout(industryId);
    if (industry) {
      return { layout: industry, source: 'industry' };
    }
  }

  if (roleSlug) {
    const role = getRoleDefaultLayout(roleSlug);
    if (role) {
      return { layout: role, source: 'role' };
    }
  }

  return { layout: getPlanDefaultLayout(planName), source: 'plan' };
}
