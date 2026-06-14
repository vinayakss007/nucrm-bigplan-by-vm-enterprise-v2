import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { modules, tenantModules } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
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
      dbModules.map(m => [m.id, (m.manifest as Record<string, unknown>)?.pricing || null])
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
    return apiError(err);
  }
}

const updateModuleSchema = z.object({
  module_id: z.string().min(1),
  pricing: z.record(z.string(), z.any()).optional(),
  is_available: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const validated = validateBody(updateModuleSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    if (v.pricing) {
      await db.update(modules)
        .set({
          manifest: sql`jsonb_set(COALESCE(manifest, '{}'::jsonb), '{pricing}', ${JSON.stringify(v.pricing)}::jsonb)`,
        })
        .where(eq(modules.id, v.module_id));

      return NextResponse.json({ ok: true });
    }

    if (v.is_available !== undefined) {
      await db.execute(sql`
        UPDATE public.modules SET is_available = ${v.is_available}, updated_at = now() WHERE id = ${v.module_id}
      `);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'No valid update fields' }, { status: 400 });
  } catch (err: any) {
    console.error('[superadmin/modules PATCH]', err);
    return apiError(err);
  }
}
