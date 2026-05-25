/**
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
}
