/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { modules } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { BUILTIN_MODULES } from '@/lib/modules/registry';
import { logSuperAdminAction } from '@/lib/audit/super-admin';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (_req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(_req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id: planId } = await params;

    const dbModules = await db.select({
      id: modules.id,
      manifest: modules.manifest,
    }).from(modules);

    const offerings = BUILTIN_MODULES.map(m => {
      const dbMod = dbModules.find(d => d.id === m.id);
      const savedPricing = (dbMod?.manifest as Record<string, unknown>)?.pricing as Record<string, { enabled?: boolean; price?: number }> | undefined;
      const planPricing = savedPricing?.[planId] ?? m.pricing?.[planId as keyof typeof m.pricing] ?? { enabled: false };

      return {
        module_id: m.id,
        name: m.name,
        category: m.category,
        icon: m.icon,
        description: m.description,
        enabled: Boolean(planPricing.enabled),
        price: typeof planPricing.price === 'number' ? planPricing.price : null,
        is_overridden: Boolean(savedPricing?.[planId]),
      };
    });

    return NextResponse.json({ plan_id: planId, offerings });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/plans/[id]/offerings GET]', err);
    return apiError(err);
  }
});

export const PUT = withApiRoute(async (req: NextRequest,
  { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { id: planId } = await params;
    const body = await readJsonBody(req);
    const { offerings } = body as {
      offerings: { module_id: string; enabled: boolean; price?: number | null }[];
    };

    if (!Array.isArray(offerings)) {
      return NextResponse.json({ error: 'offerings must be an array' }, { status: 400 });
    }

    for (const item of offerings) {
      const builtin = BUILTIN_MODULES.find(m => m.id === item.module_id);
      if (!builtin) continue;

      const existing = await db.select({ id: modules.id, manifest: modules.manifest })
        .from(modules)
        .where(eq(modules.id, item.module_id))
        .limit(1);

      const currentManifest = (existing[0]?.manifest as Record<string, unknown>) ?? {};
      const currentPricing = (currentManifest.pricing as Record<string, unknown>) ?? {};

      const updatedPricing: Record<string, unknown> = {
        ...currentPricing,
        [planId]: {
          enabled: item.enabled,
          price: item.price ?? builtin.pricing?.[planId as keyof typeof builtin.pricing]?.price ?? 0,
        },
      };

    // Optimistic concurrency guard (superadmin)
    const _eu = body?.expectedUpdatedAt ?? body?._updated_at;
    if (_eu) {
      const _cg = await concurrencyGuard(db, modules, body?.id ?? null, null, _eu);
      if (_cg) return _cg;
    }

      await db.update(modules)
        .set({
          manifest: { ...currentManifest, pricing: updatedPricing },
          updatedAt: new Date(),
        })
        .where(eq(modules.id, item.module_id));
    }

    logSuperAdminAction({
      adminId: ctx.userId,
      adminEmail: ctx.user?.email || '',
      action: 'settings.changed',
      targetType: 'plan',
      targetId: planId,
      targetName: planId,
      metadata: { offerings_count: offerings.length },
    });

    return NextResponse.json({ ok: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[superadmin/plans/[id]/offerings PUT]', err);
    return apiError(err);
  }
});
