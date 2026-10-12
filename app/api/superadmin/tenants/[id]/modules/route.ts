/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { modules, tenantModules } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { BUILTIN_MODULES, ModuleRegistry } from '@/lib/modules/registry';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { withApiRoute } from '@/lib/api/with-api-route';
import { withTenantContext, type RlsTransaction } from '@/lib/db/rls';

type InstalledModule = {
  moduleId: string;
  status: string | null;
  forceEnabled: boolean | null;
  enabledFeatures: unknown;
  installedAt: Date | null;
};

export const GET = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;

    // Get tenant's installed modules.
    //
    // tenant_modules isolates on app.current_tenant and has no super-admin
    // escape, so a platform-console connection matches zero rows and the panel
    // always reported "nothing installed". The read runs in a transaction that
    // carries the *target* tenant's context — scoped to that transaction, so it
    // cannot leak to any other query or open a write path.
    const installed = await withTenantContext<InstalledModule[]>(tenantId, ctx.userId, async (tx) =>
      tx
        .select({
          moduleId: tenantModules.moduleId,
          status: tenantModules.status,
          forceEnabled: tenantModules.forceEnabled,
          enabledFeatures: tenantModules.enabledFeatures,
          installedAt: tenantModules.installedAt,
        })
        .from(tenantModules)
        .where(eq(tenantModules.tenantId, tenantId))
    );

    const installedMap = new Map(installed.map(i => [i.moduleId, i]));

    // Get plan info
    const plan = await ModuleRegistry.getTenantPlan(tenantId);

    // Merge with all available modules
    const allModules = BUILTIN_MODULES.map(m => {
      const inst = installedMap.get(m.id);
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        icon: m.icon,
        features: m.features,
        status: inst?.status || 'available',
        forceEnabled: inst?.forceEnabled || false,
        enabledFeatures: (inst?.enabledFeatures as string[]) ?? (m.features ?? []),
        installedAt: inst?.installedAt || null,
        planAllowed: !!(m.pricing?.[plan]?.enabled),
        pricing: m.pricing,
      };
    });

    return NextResponse.json({ data: allModules, plan });
 
 
  } catch (err) {
    return apiError(err);
  }
});

const moduleActionSchema = z.object({
  module_id: z.string().min(1),
  action: z.string().min(1),
  settings: z.record(z.string(), z.any()).optional(),
  force_enabled: z.boolean().optional(),
  features: z.array(z.string()).optional(),
});

export const POST = withApiRoute(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;

    const body = await readJsonBody(request);
    const validated = validateBody(moduleActionSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // tenant_modules isolates on app.current_tenant with no super-admin escape, so
    // these writes ran as the console's *own* tenant: UPDATE matched zero rows and
    // INSERT raised 42501, while the route still answered {success:true}. Each
    // action therefore runs in a transaction carrying the target tenant's context
    // and reports the row it actually touched.
    const asTenant = <T>(fn: (tx: RlsTransaction) => Promise<T>) =>
      withTenantContext<T>(tenantId, ctx.userId, fn);

    // Super admin can force-install ANY module — bypass plan gates
    if (v.action === 'install') {
      const manifest = ModuleRegistry.get(v.module_id);
      if (!manifest) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
      const touched = await asTenant(async (tx) => {
        await tx.insert(modules).values({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description ?? null,
          category: manifest.category ?? null,
          icon: manifest.icon ?? null,
          manifest: manifest,
        }).onConflictDoNothing();
        // Force-enabled so the plan gate in the tenant's own app accepts it.
        const rows = await tx.insert(tenantModules).values({
          tenantId,
          moduleId: v.module_id,
          status: 'active',
          settings: v.settings ?? {},
          enabledFeatures: [],
          forceEnabled: v.force_enabled !== false,
          installedBy: ctx.userId,
        }).onConflictDoUpdate({
          target: [tenantModules.tenantId, tenantModules.moduleId],
          set: {
            status: 'active',
            settings: v.settings ?? {},
            forceEnabled: v.force_enabled !== false,
            updatedAt: new Date(),
          },
        }).returning({ moduleId: tenantModules.moduleId });
        return rows.length;
      });
      if (!touched) {
        return NextResponse.json({ error: `Module ${v.module_id} could not be installed for this tenant.` }, { status: 409 });
      }
      await logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || "",
        action: 'tenant.settings_changed',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: { module_install: v.module_id, force_enabled: v.force_enabled },
      });
      return NextResponse.json({ success: true, message: 'Module installed for tenant' });
    }

    if (v.action === 'disable') {
      const updated = await asTenant<{ moduleId: string }[]>(tx => tx.update(tenantModules)
        .set({ status: 'disabled', updatedAt: new Date() })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, v.module_id)))
        .returning({ moduleId: tenantModules.moduleId }));
      if (!updated.length) {
        return NextResponse.json({ error: `Module ${v.module_id} is not installed for this tenant.` }, { status: 404 });
      }
      await logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || "",
        action: 'tenant.settings_changed',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: { module_disable: v.module_id },
      });
      return NextResponse.json({ success: true });
    }

    if (v.action === 'force') {
      const updated = await asTenant<{ moduleId: string }[]>(tx => tx.update(tenantModules)
        .set({ forceEnabled: v.force_enabled, status: v.force_enabled ? 'active' : 'disabled' })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, v.module_id)))
        .returning({ moduleId: tenantModules.moduleId }));
      if (!updated.length) {
        return NextResponse.json({ error: `Module ${v.module_id} is not installed for this tenant.` }, { status: 404 });
      }
      await logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || "",
        action: 'tenant.settings_changed',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: { module_force: v.module_id, force_enabled: v.force_enabled },
      });
      return NextResponse.json({ success: true });
    }

    if (v.action === 'update_features') {
      if (!v.features) return NextResponse.json({ error: 'features array required' }, { status: 400 });
      // Validate features are valid for the module
      const manifest = ModuleRegistry.get(v.module_id);
      if (!manifest) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
      const validFeatures = new Set(manifest.features ?? []);
      const invalid = v.features.filter(f => !validFeatures.has(f));
      if (invalid.length) return NextResponse.json({ error: `Invalid features: ${invalid.join(', ')}` }, { status: 400 });
      const updated = await asTenant<{ moduleId: string }[]>(tx => tx.update(tenantModules)
        .set({ enabledFeatures: v.features, updatedAt: new Date() })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, v.module_id)))
        .returning({ moduleId: tenantModules.moduleId }));
      if (!updated.length) {
        return NextResponse.json({ error: `Module ${v.module_id} is not installed for this tenant.` }, { status: 404 });
      }
      await logSuperAdminAction({
        adminId: ctx.userId,
        adminEmail: ctx.user?.email || "",
        action: 'tenant.settings_changed',
        targetType: 'tenant',
        targetId: tenantId,
        metadata: { module_features: v.module_id, enabled_features: v.features },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
 
 
  } catch (err) {
    return apiError(err);
  }
});
