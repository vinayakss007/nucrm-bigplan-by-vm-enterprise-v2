import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { modules, tenantModules } from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import { BUILTIN_MODULES } from '@/lib/modules/registry';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const stats = await db
      .select({
        moduleId: tenantModules.moduleId,
        totalInstalls: sql<number>`count(*)::int`,
        activeInstalls: sql<number>`count(*) FILTER (WHERE ${tenantModules.status} = 'active')::int`,
      })
      .from(tenantModules)
      .groupBy(tenantModules.moduleId);

    const statsMap = Object.fromEntries(stats.map(s => [s.moduleId, s]));

    // Load saved pricing from modules table
    const dbModules = await db.select({
      id: modules.id,
      manifest: modules.manifest,
    }).from(modules);

    const savedPricing = Object.fromEntries(
      dbModules.map(m => [m.id, (m.manifest as any)?.pricing || null])
    );

    const data = BUILTIN_MODULES.map(m => ({
      ...m,
      total_installs: statsMap[m.id]?.totalInstalls ?? 0,
      active_installs: statsMap[m.id]?.activeInstalls ?? 0,
      // Use saved pricing if available, otherwise fall back to built-in
      pricing: savedPricing[m.id] || m.pricing,
    }));

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[superadmin/modules GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();

    if (body.pricing) {
      // Update per-plan pricing config
      await db.update(modules)
        .set({
          manifest: sql`jsonb_set(COALESCE(manifest, '{}'::jsonb), '{pricing}', ${JSON.stringify(body.pricing)}::jsonb)`,
        })
        .where(eq(modules.id, body.module_id));

      return NextResponse.json({ ok: true });
    }

    if (body.is_available !== undefined) {
      await db.execute(sql`
        UPDATE public.modules SET is_available = ${body.is_available}, updated_at = now() WHERE id = ${body.module_id}
      `);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'No valid update fields' }, { status: 400 });
  } catch (err: any) {
    console.error('[superadmin/modules PATCH]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
