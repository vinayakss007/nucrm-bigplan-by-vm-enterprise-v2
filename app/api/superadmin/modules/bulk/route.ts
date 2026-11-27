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
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { withApiRoute } from '@/lib/api/with-api-route';
import { logError } from '@/lib/errors-server';

class ModuleRowMissError extends Error {
  constructor(readonly moduleId: string) {
    super(`Module ${moduleId} has no row to update`);
    this.name = 'ModuleRowMissError';
  }
}

const updateModuleBulkSchema = z.object({
  updates: z.array(
    z.object({
      id: z.string().min(1),
      pricing: z.record(z.string(), z.any()),
    })
  ).max(100)
});

export const PATCH = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await readJsonBody(req);
    const validated = validateBody(updateModuleBulkSchema, body);
    if (validated instanceof NextResponse) return validated;
    const { updates } = validated.data;

    if (updates.length === 0) {
      return NextResponse.json({ ok: true });
    }

    // Built-in modules have no `modules` row until a tenant installs one, so
    // an UPDATE can silently match zero rows. Verify both available witnesses
    // (driver rowCount and RETURNING rows) and roll the whole batch back on
    // a miss instead of reporting a successful save that changed nothing.
    await db.transaction(async (tx) => {
      for (const update of updates) {
        const result = await tx.execute(sql`
          UPDATE public.modules
          SET manifest = jsonb_set(COALESCE(manifest, '{}'::jsonb), '{pricing}', ${JSON.stringify(update.pricing)}::jsonb),
              updated_at = now()
          WHERE id = ${update.id}
          RETURNING id
        `);
        const resultRows = (result as { rows?: unknown[] } | undefined)?.rows;
        const rowCount = (result as { rowCount?: number | null } | undefined)?.rowCount;
        const witnesses: number[] = [];
        if (typeof rowCount === 'number') witnesses.push(rowCount);
        if (Array.isArray(resultRows)) witnesses.push(resultRows.length);
        const written = witnesses.length > 0 ? Math.min(...witnesses) : 0;
        if (written !== 1) throw new ModuleRowMissError(update.id);
      }
    });

    await logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || "",
      action: 'settings.changed',
      targetType: 'module',
      targetId: 'bulk',
      metadata: {
        pricing: true,
        updated_modules: updates.map(u => u.id)
      },
    });

    return NextResponse.json({ ok: true, count: updates.length });
  } catch (err) {
    if (err instanceof ModuleRowMissError) {
      return NextResponse.json({
        ok: false,
        error: 'Module pricing was not saved: the module has no installed row',
        moduleId: err.moduleId,
      }, { status: 404 });
    }
    await logError({ error: err, context: 'superadmin/modules/bulk PATCH', requestMethod: 'PATCH' });
    return apiError(err);
  }
});
