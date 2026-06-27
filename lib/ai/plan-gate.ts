/**
 * Plan-Based AI Feature Gate
 *
 * Checks if the current tenant's plan includes a specific AI feature.
 * Used as middleware in AI API routes to enforce plan-based access control.
 *
 * Super admins always bypass all checks.
 */
import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { plans, tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import type { AuthContext } from '@/lib/auth/middleware';

/**
 * Check if a tenant's plan includes a specific AI feature key.
 * Returns null if allowed, NextResponse if blocked.
 *
 * Usage in API routes:
 *   const gate = await requireAiFeature(ctx, 'ai_sentiment');
 *   if (gate) return gate;
 */
export async function requireAiFeature(
  ctx: AuthContext,
  featureKey: string,
): Promise<NextResponse | null> {
  // Super admins bypass all plan checks
  if (ctx.isSuperAdmin) return null;

  // Fetch tenant's plan features
  const row = await db
    .select({ features: plans.features })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1)
    .then(r => r[0]);

  const features = (row?.features as string[]) ?? [];

  if (!features.includes(featureKey)) {
    return NextResponse.json(
      {
        error: `This AI feature is not available on your current plan.`,
        feature: featureKey,
        upgrade_required: true,
      },
      { status: 403 },
    );
  }

  return null;
}

/**
 * Check if a plan has a specific feature (non-request context).
 * Useful for server components or background jobs.
 */
export async function planHasFeature(
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  const row = await db
    .select({ features: plans.features })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, tenantId))
    .limit(1)
    .then(r => r[0]);

  const features = (row?.features as string[]) ?? [];
  return features.includes(featureKey);
}
