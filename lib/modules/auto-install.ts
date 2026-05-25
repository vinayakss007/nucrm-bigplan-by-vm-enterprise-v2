/**
 * Module Auto-Install
 *
 * Automatically installs the correct set of modules for a tenant
 * based on their plan. The platform is designed as a modular CRM backend
 * that powers multiple small SaaS products - each tenant/use-case only
 * gets the modules relevant to them (real estate, tech, agency, etc.).
 *
 * Tenants can later selectively add more modules (lead scoring, WhatsApp,
 * email automation, campaigns) through the marketplace.
 */
import { db } from '@/drizzle/db';
import { modules, tenantModules } from '@/drizzle/schema/modules';
import { BUILTIN_MODULES } from '@/lib/modules/registry';

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
 * Install default modules for a tenant based on their plan.
 * This is called after tenant creation (signup or admin setup).
 * Skips modules that are already installed.
 */
export async function installDefaultModules(
  tenantId: string,
  planId: string
): Promise<void> {
  const moduleIds = getDefaultModulesForPlan(planId);

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
}
