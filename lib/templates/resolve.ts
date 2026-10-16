/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2633 — template resolution against the DB (product_templates), which after
 * migration 0128 is the single source of truth for the 13 builtins plus any
 * superadmin-authored template. Consumers used to read the hardcoded
 * INDUSTRY_TEMPLATES map, so superadmin edits/creations were invisible to
 * onboarding, setup, assign and the dashboard defaults.
 *
 * Lookup accepts a template id (uuid) OR slug ('legal', 'saas', ...) — 0128
 * seeded slug = the old hardcoded key, so every existing caller keeps working.
 * Only status='active', not-soft-deleted rows resolve.
 */
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { productTemplates } from '@/drizzle/schema';
import type { TemplateBlueprint } from './apply-template';

export interface ResolvedTemplate extends TemplateBlueprint {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  icon: string | null;
  modules: string[];
  defaultDashboardLayout: Array<{ widget: string; position: number; size: string; config?: Record<string, unknown> }>;
  isBuiltin: boolean;
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export async function resolveTemplate(idOrSlug: string, client: typeof db = db): Promise<ResolvedTemplate | null> {
  if (!idOrSlug) return null;
  const [row] = await client
    .select()
    .from(productTemplates)
    .where(and(
      isNull(productTemplates.deletedAt),
      eq(productTemplates.status, 'active'),
      isUuid(idOrSlug)
        ? eq(productTemplates.id, idOrSlug)
        : eq(productTemplates.slug, idOrSlug),
    ))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    modules: Array.isArray(row.modules) ? row.modules as string[] : [],
    custom_fields: Array.isArray(row.customFields) ? row.customFields as TemplateBlueprint['custom_fields'] : [],
    pipelines: Array.isArray(row.pipelines) ? row.pipelines as TemplateBlueprint['pipelines'] : [],
    automations: Array.isArray(row.automations) ? row.automations as TemplateBlueprint['automations'] : [],
    defaultDashboardLayout: Array.isArray(row.defaultDashboardLayout) ? row.defaultDashboardLayout as ResolvedTemplate['defaultDashboardLayout'] : [],
    isBuiltin: row.isBuiltin ?? false,
  };
}

/** Every active template, for listing endpoints. */
export async function listActiveTemplates(client: typeof db = db): Promise<ResolvedTemplate[]> {
  const rows = await client
    .select()
    .from(productTemplates)
    .where(and(
      isNull(productTemplates.deletedAt),
      eq(productTemplates.status, 'active'),
    ))
    .orderBy(sql`${productTemplates.name} asc`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    modules: Array.isArray(row.modules) ? row.modules as string[] : [],
    custom_fields: Array.isArray(row.customFields) ? row.customFields as TemplateBlueprint['custom_fields'] : [],
    pipelines: Array.isArray(row.pipelines) ? row.pipelines as TemplateBlueprint['pipelines'] : [],
    automations: Array.isArray(row.automations) ? row.automations as TemplateBlueprint['automations'] : [],
    defaultDashboardLayout: Array.isArray(row.defaultDashboardLayout) ? row.defaultDashboardLayout as ResolvedTemplate['defaultDashboardLayout'] : [],
    isBuiltin: row.isBuiltin ?? false,
  }));
}
