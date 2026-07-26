import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { getBrandingForTenant, BrandingConfig } from '@/lib/branding';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

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

export async function GET(request: NextRequest) {
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
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const validated = validateBody(brandingUpdateSchema, body);
    if (validated instanceof NextResponse) return validated;

    const data = validated.data;

    const tenantUpdate: Record<string, unknown> = {};
    if (data.logoUrl !== undefined) tenantUpdate['logoUrl'] = data.logoUrl;
    if (data.faviconUrl !== undefined) tenantUpdate['faviconUrl'] = data.faviconUrl;
    if (data.primaryColor !== undefined) tenantUpdate['primaryColor'] = data.primaryColor;
    if (data.customDomain !== undefined) tenantUpdate['customDomain'] = data.customDomain;

    if (Object.keys(tenantUpdate).length > 0) {
      const [existing1] = await db
        .select({ updatedAt: tenants.updatedAt })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      if (!existing1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const [updated1] = await db.update(tenants)
        .set({ ...tenantUpdate, updatedAt: new Date() })
        .where(and(eq(tenants.id, ctx.tenantId), eq(tenants.updatedAt, existing1.updatedAt!)))
        .returning({ id: tenants.id });

      if (!updated1) return NextResponse.json({ error: 'Conflicts with another update' }, { status: 409 });
    }

    const extendedBranding: Partial<BrandingConfig> = {};
    if (data.secondaryColor !== undefined) extendedBranding.secondaryColor = data.secondaryColor;
    if (data.accentColor !== undefined) extendedBranding.accentColor = data.accentColor;
    if (data.companyName !== undefined) extendedBranding.companyName = data.companyName;
    if (data.hidePoweredBy !== undefined) extendedBranding.hidePoweredBy = data.hidePoweredBy;
    if (data.customCss !== undefined) extendedBranding.customCss = data.customCss;
    if (data.headerLayout !== undefined) extendedBranding.headerLayout = data.headerLayout;

    if (Object.keys(extendedBranding).length > 0) {
      const [existing2] = await db.select({ settings: tenants.settings, updatedAt: tenants.updatedAt })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);
      if (!existing2) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const currentSettings = (existing2.settings as Record<string, unknown>) ?? {};
      const currentBranding = (currentSettings['branding'] as Record<string, unknown>) ?? {};

      const [updated2] = await db.update(tenants)
        .set({
          settings: {
            ...currentSettings,
            branding: { ...currentBranding, ...extendedBranding },
          },
          updatedAt: new Date(),
        })
        .where(and(eq(tenants.id, ctx.tenantId), eq(tenants.updatedAt, existing2.updatedAt!)))
        .returning({ id: tenants.id });

      if (!updated2) return NextResponse.json({ error: 'Conflicts with another update' }, { status: 409 });
    }

    const updatedBranding = await getBrandingForTenant(ctx.tenantId);
    return NextResponse.json({ data: updatedBranding });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Branding] PUT error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
