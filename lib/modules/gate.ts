/**
 * Module Enforcement Gate
 *
 * Provides functions to verify a tenant has access to a specific module
 * or feature before allowing API/page access. This is the runtime enforcement
 * layer that complements the plan-based module installation system.
 *
 * The system is designed so each tenant only gets modules relevant to their
 * use case (real estate, tech, agency, etc.) and can selectively enable
 * additional features (lead scoring, campaigns, WhatsApp, email automation)
 * without giving everyone everything.
 */
import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { modules, tenantModules } from '@/drizzle/schema/modules';
import { eq, and } from 'drizzle-orm';

/**
 * Check if a tenant has access to a module.
 * Returns null if access is granted, or a 403 NextResponse if blocked.
 */
export async function requireModule(
  tenantId: string,
  moduleId: string
): Promise<NextResponse | null> {
  try {
    // Check if the module exists and is available in the registry
    const moduleRow = await db.query.modules.findFirst({
      where: eq(modules.id, moduleId),
      columns: { id: true, isAvailable: true },
    });

    if (!moduleRow) {
      return NextResponse.json(
        { error: `Module '${moduleId}' not found` },
        { status: 403 }
      );
    }

    // Check tenant installation status
    const installation = await db.query.tenantModules.findFirst({
      where: and(
        eq(tenantModules.tenantId, tenantId),
        eq(tenantModules.moduleId, moduleId)
      ),
      columns: { status: true, forceEnabled: true },
    });

    // Allow if force-enabled by super admin
    if (installation?.forceEnabled) {
      return null;
    }

    // Check if module is active for this tenant
    if (!installation || installation.status !== 'active') {
      return NextResponse.json(
        { error: `Module '${moduleId}' is not enabled for your workspace. Enable it in Settings > Modules.` },
        { status: 403 }
      );
    }

    return null;
  } catch (error) {
    console.error('[gate.requireModule] Error checking module access:', error);
    return NextResponse.json(
      { error: 'Failed to verify module access' },
      { status: 500 }
    );
  }
}

/**
 * Check if a tenant has access to a specific feature within a module.
 * This allows granular feature-level gating so tenants only see what
 * is relevant to their business type / use case.
 * Returns null if access is granted, or a 403 NextResponse if blocked.
 */
export async function requireFeature(
  tenantId: string,
  moduleId: string,
  featureKey: string
): Promise<NextResponse | null> {
  try {
    const installation = await db.query.tenantModules.findFirst({
      where: and(
        eq(tenantModules.tenantId, tenantId),
        eq(tenantModules.moduleId, moduleId)
      ),
      columns: { status: true, forceEnabled: true, enabledFeatures: true },
    });

    // Force-enabled bypasses feature checks
    if (installation?.forceEnabled) {
      return null;
    }

    // Module must be active
    if (!installation || installation.status !== 'active') {
      return NextResponse.json(
        { error: `Module '${moduleId}' is not enabled for your workspace.` },
        { status: 403 }
      );
    }

    // Check feature-level access
    const enabledFeatures = (installation.enabledFeatures as string[] | null) ?? [];

    // If no feature restrictions are set (empty array), allow all features
    if (enabledFeatures.length === 0) {
      return null;
    }

    if (!enabledFeatures.includes(featureKey)) {
      return NextResponse.json(
        { error: `Feature '${featureKey}' is not enabled. Contact your administrator to enable it.` },
        { status: 403 }
      );
    }

    return null;
  } catch (error) {
    console.error('[gate.requireFeature] Error checking feature access:', error);
    return NextResponse.json(
      { error: 'Failed to verify feature access' },
      { status: 500 }
    );
  }
}
