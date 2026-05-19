import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { modules, tenantModules } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { BUILTIN_MODULES, ModuleRegistry } from '@/lib/modules/registry';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;

    // Get tenant's installed modules
    const installed = await ModuleRegistry.getTenantModules(tenantId);
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id: tenantId } = await params;

    const body = await request.json();
    if (!body.module_id) return NextResponse.json({ error: 'module_id required' }, { status: 400 });

    // Super admin can force-install ANY module — bypass plan gates
    if (body.action === 'install') {
      await ModuleRegistry.install(tenantId, body.module_id, ctx.userId, body.settings || {});
      // Mark as force-enabled so plan-gate checks pass
      await db.update(tenantModules)
        .set({ forceEnabled: body.force_enabled !== false })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, body.module_id)));
      return NextResponse.json({ success: true, message: 'Module installed for tenant' });
    }

    if (body.action === 'disable') {
      await ModuleRegistry.disable(tenantId, body.module_id);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'force') {
      // Toggle force-enable override
      await db.update(tenantModules)
        .set({ forceEnabled: body.force_enabled, status: body.force_enabled ? 'active' : 'disabled' })
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, body.module_id)));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
