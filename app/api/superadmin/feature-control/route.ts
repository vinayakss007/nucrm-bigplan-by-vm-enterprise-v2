import { apiError } from '@/lib/api-error';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, tenantFeatureOverrides } from '@/drizzle/schema';
import { eq, sql, desc, isNull, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { CONTROLLABLE_FEATURES } from '@/lib/modules/feature-keys';

const VALID_FEATURE_KEYS = CONTROLLABLE_FEATURES.map(f => f.key);

const featureOverrideSchema = z.object({
  tenant_id: z.string().uuid(),
  feature_key: z.string().min(1).refine(
    (key) => VALID_FEATURE_KEYS.includes(key as typeof VALID_FEATURE_KEYS[number]),
    { message: 'Invalid feature key. Must be one of the controllable features.' }
  ),
  enabled: z.boolean(),
  reason: z.string().optional(),
});

const deleteOverrideSchema = z.object({
  tenant_id: z.string().uuid(),
  feature_key: z.string().min(1),
});

/**
 * Super Admin Feature Control API
 *
 * GET: List all tenants with their feature overrides
 * PATCH: Create/update a feature override for a tenant
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const tenantsData = await db
      .select({
        tenant_id: tenants.id,
        tenant_name: tenants.name,
        plan: tenants.planId,
        overrides: sql`COALESCE(
          json_agg(
            json_build_object(
              'feature_key', ${tenantFeatureOverrides.featureKey},
              'enabled', ${tenantFeatureOverrides.enabled},
              'granted_at', ${tenantFeatureOverrides.grantedAt},
              'reason', ${tenantFeatureOverrides.reason}
            )
          ) FILTER (WHERE ${tenantFeatureOverrides.id} IS NOT NULL),
          '[]'
        )`.as('overrides'),
      })
      .from(tenants)
      .leftJoin(tenantFeatureOverrides, eq(tenantFeatureOverrides.tenantId, tenants.id))
      .where(isNull(tenants.deletedAt))
      .groupBy(tenants.id)
      .orderBy(desc(tenants.createdAt));

    return NextResponse.json({
      data: tenantsData,
      available_features: CONTROLLABLE_FEATURES,
    });
  } catch (err: unknown) {
    console.error('[superadmin/feature-control GET]', err);
    return apiError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawBody = await request.json();
    const validated = validateBody(featureOverrideSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { tenant_id, feature_key, enabled, reason } = validated.data;

    // Upsert the feature override
    const [row] = await db
      .insert(tenantFeatureOverrides)
      .values({
        tenantId: tenant_id,
        featureKey: feature_key,
        enabled,
        grantedBy: ctx.userId,
        reason: reason ?? null,
      })
      .onConflictDoUpdate({
        target: [tenantFeatureOverrides.tenantId, tenantFeatureOverrides.featureKey],
        set: {
          enabled,
          grantedBy: ctx.userId,
          grantedAt: new Date(),
          reason: reason ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({ ok: true, data: row });
  } catch (err: unknown) {
    console.error('[superadmin/feature-control PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rawBody = await request.json();
    const validated = validateBody(deleteOverrideSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { tenant_id, feature_key } = validated.data;

    const deleted = await db
      .delete(tenantFeatureOverrides)
      .where(
        and(
          eq(tenantFeatureOverrides.tenantId, tenant_id),
          eq(tenantFeatureOverrides.featureKey, feature_key)
        )
      )
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Override not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deleted: deleted[0] });
  } catch (err: unknown) {
    console.error('[superadmin/feature-control DELETE]', err);
    return apiError(err);
  }
}
