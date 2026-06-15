import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenantModules } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { BUILTIN_MODULES, ModuleRegistry } from '@/lib/modules/registry';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;

    // Get tenant's installed modules
    const installed = await ModuleRegistry.getTenantModules(tenantId);
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const installedMap = new Map(installed.map((i: any) => [i.module_id, i]));

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
        installedAt: inst?.installed_at || null,
        planAllowed: !!(m.pricing?.[plan]?.enabled),
        pricing: m.pricing,
      };
    });

    return NextResponse.json({ data: allModules, plan });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

const moduleActionSchema = z.object({
  module_id: z.string().min(1),
  action: z.string().min(1),
  settings: z.record(z.string(), z.any()).optional(),
  force_enabled: z.boolean().optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;

    const body = await request.json();
    const validated = validateBody(moduleActionSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    // Super admin can force-install ANY module — bypass plan gates
    if (v.action === 'install') {
      await ModuleRegistry.install(tenantId, v.module_id, ctx.userId, v.settings || {});
      // Mark as force-enabled so plan-gate checks pass
      await db.update(tenantModules)
        .set({ forceEnabled: v.force_enabled !== false })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, v.module_id)));
      return NextResponse.json({ success: true, message: 'Module installed for tenant' });
    }

    if (v.action === 'disable') {
      await ModuleRegistry.disable(tenantId, v.module_id);
      return NextResponse.json({ success: true });
    }

    if (v.action === 'force') {
      // Toggle force-enable override
      await db.update(tenantModules)
        .set({ forceEnabled: v.force_enabled, status: v.force_enabled ? 'active' : 'disabled' })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, v.module_id)));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
