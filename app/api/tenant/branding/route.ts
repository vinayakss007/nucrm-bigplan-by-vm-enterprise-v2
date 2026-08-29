/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { getBrandingForTenant, BrandingConfig } from '@/lib/branding';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

const brandingUpdateSchema = z.object({
  logoUrl: z.string().trim().max(500).nullable().optional(),
  faviconUrl: z.string().trim().max(500).nullable().optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  secondaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color').optional(),
  companyName: z.string().trim().max(200).nullable().optional(),
  customDomain: z.string().trim().max(255).nullable().optional(),
  hidePoweredBy: z.boolean().optional(),
  customCss: z.string().trim().max(5000).nullable().optional(),
  headerLayout: z.enum(['default', 'centered', 'minimal']).optional(),
});

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const branding = await getBrandingForTenant(ctx.tenantId);
    return NextResponse.json({ data: branding });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Branding] GET error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

export const PUT = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'branding', 'patch');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await readJsonBody(request);
    const validated = validateBody(brandingUpdateSchema, body);
    if (validated instanceof NextResponse) return validated;

    const data = validated.data;

    // Wrap both updates in a transaction — if the second update fails,
    // the first is rolled back (prevents partial branding state).
    await db.transaction(async (tx) => {
      const tenantUpdate: Record<string, unknown> = {};
      if (data.logoUrl !== undefined) tenantUpdate['logoUrl'] = data.logoUrl;
      if (data.faviconUrl !== undefined) tenantUpdate['faviconUrl'] = data.faviconUrl;
      if (data.primaryColor !== undefined) tenantUpdate['primaryColor'] = data.primaryColor;
      if (data.customDomain !== undefined) tenantUpdate['customDomain'] = data.customDomain;

      if (Object.keys(tenantUpdate).length > 0) {
        const [existing1] = await tx
          .select({ updatedAt: tenants.updatedAt })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1);
        if (!existing1) throw new Error('NOT_FOUND');

        const guard1 = concurrencyGuard(tenants, existing1.updatedAt);
        const conditions1 = [eq(tenants.id, ctx.tenantId)];
        if (guard1) conditions1.push(guard1);

        const [updated1] = await tx.update(tenants)
          .set({ ...tenantUpdate, updatedAt: new Date() })
          .where(and(...conditions1))
          .returning({ id: tenants.id });

        if (!updated1) throw new Error('CONFLICT');
      }

      const extendedBranding: Partial<BrandingConfig> = {};
      if (data.secondaryColor !== undefined) extendedBranding.secondaryColor = data.secondaryColor;
      if (data.accentColor !== undefined) extendedBranding.accentColor = data.accentColor;
      if (data.companyName !== undefined) extendedBranding.companyName = data.companyName;
      if (data.hidePoweredBy !== undefined) extendedBranding.hidePoweredBy = data.hidePoweredBy;
      if (data.customCss !== undefined) extendedBranding.customCss = data.customCss;
      if (data.headerLayout !== undefined) extendedBranding.headerLayout = data.headerLayout;

      if (Object.keys(extendedBranding).length > 0) {
        const [existing2] = await tx.select({ settings: tenants.settings, updatedAt: tenants.updatedAt })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1);
        if (!existing2) throw new Error('NOT_FOUND');

        const guard2 = concurrencyGuard(tenants, existing2.updatedAt);
        const conditions2 = [eq(tenants.id, ctx.tenantId)];
        if (guard2) conditions2.push(guard2);

        const currentSettings = (existing2.settings as Record<string, unknown>) ?? {};
        const currentBranding = (currentSettings['branding'] as Record<string, unknown>) ?? {};

        const [updated2] = await tx.update(tenants)
          .set({
            settings: {
              ...currentSettings,
              branding: { ...currentBranding, ...extendedBranding },
            },
            updatedAt: new Date(),
          })
          .where(and(...conditions2))
          .returning({ id: tenants.id });

        if (!updated2) throw new Error('CONFLICT');
      }
    });

    const updatedBranding = await getBrandingForTenant(ctx.tenantId);
    return NextResponse.json({ data: updatedBranding });
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === 'NOT_FOUND') return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (error.message === 'CONFLICT') return NextResponse.json({ error: 'Conflicts with another update' }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Branding] PUT error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
