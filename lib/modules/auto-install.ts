/**
<<<<<<< HEAD
 * Auto-install — provision a tenant with every module their plan entitles them
 * to. Called from the signup flow and from plan-change events.
 *
 * Each module manifest declares `pricing[plan].enabled`. We install everything
 * marked enabled for the tenant's current plan and skip anything that's gated
 * or already installed.
 */
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { BUILTIN_MODULES, ModuleRegistry } from './registry';
import type { ModuleManifest } from '@/types';

export interface AutoInstallResult {
  planId: string;
  installed: string[];
  skipped: { moduleId: string; reason: string }[];
}

/**
 * Resolve the tenant's plan and install every module enabled on that plan.
 * Errors on individual modules are collected, never thrown — signup must not
 * fail because one optional module fouled up.
 */
export async function autoInstallForPlan(
  tenantId: string,
  installedBy: string,
  options: { planId?: string } = {},
): Promise<AutoInstallResult> {
  const planId = options.planId ?? (await resolvePlanId(tenantId));
  const targets = pickEnabledModules(planId);

  const installed: string[] = [];
  const skipped: { moduleId: string; reason: string }[] = [];

  for (const manifest of targets) {
    try {
      const res = await ModuleRegistry.install(tenantId, manifest.id, installedBy);
      if (res.ok) installed.push(manifest.id);
      else skipped.push({ moduleId: manifest.id, reason: res.error ?? 'install failed' });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'install threw';
      skipped.push({ moduleId: manifest.id, reason });
    }
  }

  return { planId, installed, skipped };
}

/** Return every BUILTIN_MODULES manifest whose pricing for `planId` is enabled. */
export function pickEnabledModules(planId: string): ModuleManifest[] {
  return BUILTIN_MODULES.filter((m) => isEnabledOnPlan(m, planId));
}

function isEnabledOnPlan(manifest: ModuleManifest, planId: string): boolean {
  const pricing = manifest.pricing as Record<string, { enabled?: boolean } | undefined> | undefined;
  if (!pricing) return false;
  const cfg = pricing[planId];
  return cfg?.enabled === true;
}

async function resolvePlanId(tenantId: string): Promise<string> {
  const row = await db
    .select({ planId: tenants.planId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row[0]?.planId || 'free';
=======
 * Module Auto-Install
 *
 * Automatically installs the correct set of modules for a tenant
 * based on their plan and/or industry template. The platform is designed
 * as a modular CRM backend that powers multiple small SaaS products -
 * each tenant/use-case only gets the modules relevant to them
 * (real estate, tech, agency, recruitment, etc.).
 *
 * Tenants can later selectively add more modules (lead scoring, WhatsApp,
 * email automation, campaigns) through the marketplace.
 */
import { db } from '@/drizzle/db';
import { modules, tenantModules } from '@/drizzle/schema/modules';
import { BUILTIN_MODULES } from '@/lib/modules/registry';
import { INDUSTRY_TEMPLATES } from '@/lib/modules/industry-templates';

/**
 * Plan-to-default-modules mapping.
 * Each plan tier gets a curated set of modules installed on signup.
 * Additional modules can be purchased/enabled individually.
 */
const PLAN_DEFAULT_MODULES: Record<string, string[]> = {
  free: ['core-crm', 'automation-basic'],
  starter: [
    'core-crm',
    'automation-basic',
    'automation-pro',
    'service-helpdesk',
    'sales-quotes',
    'marketing-segments',
    'whatsapp-bot',
    'email-sync',
  ],
  pro: [
    'core-crm',
    'automation-basic',
    'automation-pro',
    'service-helpdesk',
    'sales-quotes',
    'marketing-segments',
    'whatsapp-bot',
    'email-sync',
    'ai-assistant',
    'forms-builder',
    'calculated-fields',
    'analytics-pro',
  ],
  enterprise: [
    'core-crm',
    'automation-basic',
    'automation-pro',
    'service-helpdesk',
    'sales-quotes',
    'marketing-segments',
    'whatsapp-bot',
    'email-sync',
    'ai-assistant',
    'forms-builder',
    'calculated-fields',
    'industry-templates',
    'analytics-pro',
  ],
};

/**
 * Get the default module IDs for a given plan.
 */
export function getDefaultModulesForPlan(planId: string): string[] {
  return PLAN_DEFAULT_MODULES[planId] ?? PLAN_DEFAULT_MODULES['free'] ?? [];
}

/**
 * Get the combined module list for a plan + optional industry template.
 * Template modules are merged with plan modules (union, no duplicates).
 */
export function getModulesForPlanAndTemplate(planId: string, templateId?: string): string[] {
  const planModules = getDefaultModulesForPlan(planId);

  if (!templateId) return planModules;

  const template = INDUSTRY_TEMPLATES[templateId];
  if (!template) return planModules;

  // Merge plan modules with template modules (deduplicated)
  const combined = new Set([...planModules, ...template.modules]);
  return Array.from(combined);
}

/**
 * Get the module IDs for a specific industry template.
 * Returns only modules that exist in BUILTIN_MODULES.
 */
export function getTemplateModules(templateId: string): string[] {
  const template = INDUSTRY_TEMPLATES[templateId];
  if (!template) return [];

  const validModuleIds = new Set(BUILTIN_MODULES.map(m => m.id));
  return template.modules.filter(id => validModuleIds.has(id));
}

/**
 * Install template-specific modules for a tenant.
 * This installs only the modules defined in the industry template,
 * skipping any that are already installed.
 */
export async function installTemplateModules(
  tenantId: string,
  templateId: string
): Promise<void> {
  const moduleIds = getTemplateModules(templateId);

  if (moduleIds.length === 0) return;

  try {
    for (const moduleId of moduleIds) {
      const manifest = BUILTIN_MODULES.find(m => m.id === moduleId);
      if (!manifest) continue;

      // Ensure module exists in registry table
      await db
        .insert(modules)
        .values({
          id: moduleId,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? null,
          category: manifest.category ?? null,
          icon: manifest.icon ?? null,
          manifest: manifest,
        })
        .onConflictDoNothing();

      // Install for tenant (skip if already installed)
      await db
        .insert(tenantModules)
        .values({
          tenantId,
          moduleId,
          status: 'active',
          enabledFeatures: [],
          settings: {},
        })
        .onConflictDoNothing();
    }
  } catch (error) {
    console.error('[auto-install] Failed to install template modules:', error);
  }
}

/**
 * Install default modules for a tenant based on their plan.
 * Optionally accepts an industry template to merge additional modules.
 * This is called after tenant creation (signup or admin setup).
 * Skips modules that are already installed.
 */
export async function installDefaultModules(
  tenantId: string,
  planId: string,
  industryTemplate?: string
): Promise<void> {
  const moduleIds = getModulesForPlanAndTemplate(planId, industryTemplate);

  if (moduleIds.length === 0) return;

  try {
    for (const moduleId of moduleIds) {
      const manifest = BUILTIN_MODULES.find(m => m.id === moduleId);
      if (!manifest) continue;

      // Ensure module exists in registry table
      await db
        .insert(modules)
        .values({
          id: moduleId,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? null,
          category: manifest.category ?? null,
          icon: manifest.icon ?? null,
          manifest: manifest,
        })
        .onConflictDoNothing();

      // Install for tenant (skip if already installed)
      await db
        .insert(tenantModules)
        .values({
          tenantId,
          moduleId,
          status: 'active',
          enabledFeatures: [],
          settings: {},
        })
        .onConflictDoNothing();
    }
  } catch (error) {
    console.error('[auto-install] Failed to install default modules:', error);
    // Non-fatal: tenant can still use the platform, modules can be installed later
  }
>>>>>>> main
}
