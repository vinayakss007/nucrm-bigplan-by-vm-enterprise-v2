<<<<<<< HEAD
/**
 * GET   /api/tenant/branding  — read the tenant's branding fields
 * PATCH /api/tenant/branding  — update them (admin only)
 *
 * Thin specialised endpoint that wraps the same fields the workspace
 * route already exposes, but with stricter validation (hex colour,
 * URL shape, custom domain shape) so the branding settings page can
 * give better error messages without re-implementing them.
 *
 * Updates also bust the workspace cache so the navbar logo refreshes
 * without a hard reload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { invalidateCache } from '@/lib/db/cache';
import { safeColor, type TenantBranding } from '@/lib/branding';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Allow http/https URLs up to 2KB. Path-only URLs (/static/foo.png) are also
// fine — admins might host the logo on the same origin.
const URL_LIKE = /^(https?:\/\/|\/)[^\s]{0,2000}$/i;
// Custom domain shape — same as a normal hostname, but disallow protocol
// and trailing path. Validation is intentionally lax; the actual DNS
// verification happens out-of-band.
const DOMAIN_LIKE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const [row] = await db
    .select({
      primaryColor: tenants.primaryColor,
      logoUrl: tenants.logoUrl,
      customDomain: tenants.customDomain,
      subdomain: tenants.subdomain,
    })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);

  if (!row) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

  const branding: TenantBranding = {
    primaryColor: safeColor(row.primaryColor),
    logoUrl: row.logoUrl,
    customDomain: row.customDomain,
  };
  return NextResponse.json({ data: { ...branding, subdomain: row.subdomain } });
}

interface BrandingInput {
  primary_color?: string;
  logo_url?: string | null;
  custom_domain?: string | null;
  subdomain?: string | null;
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as BrandingInput | null;
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });

  const update: {
    primaryColor?: string;
    logoUrl?: string | null;
    customDomain?: string | null;
    subdomain?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (body.primary_color !== undefined) {
    if (!HEX_COLOR.test(body.primary_color)) {
      return NextResponse.json(
        { error: 'primary_color must be a hex colour like #7c3aed' },
        { status: 400 },
      );
    }
    update.primaryColor = body.primary_color;
  }

  if (body.logo_url !== undefined) {
    if (body.logo_url !== null && !URL_LIKE.test(body.logo_url)) {
      return NextResponse.json(
        { error: 'logo_url must be a https URL or a / path' },
        { status: 400 },
      );
    }
    update.logoUrl = body.logo_url;
  }

  if (body.custom_domain !== undefined) {
    const cd = body.custom_domain ? body.custom_domain.trim().toLowerCase() : null;
    if (cd && !DOMAIN_LIKE.test(cd)) {
      return NextResponse.json(
        { error: 'custom_domain must be a bare hostname like crm.acme.com' },
        { status: 400 },
      );
    }
    update.customDomain = cd;
  }

  if (body.subdomain !== undefined) {
    const sd = body.subdomain ? body.subdomain.trim().toLowerCase() : null;
    if (sd && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(sd)) {
      return NextResponse.json(
        { error: 'subdomain must be 1-32 lowercase alphanumeric characters or hyphens' },
        { status: 400 },
      );
    }
    update.subdomain = sd;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  try {
    await db.update(tenants).set(update).where(eq(tenants.id, ctx.tenantId));
  } catch (err) {
    // unique violation on customDomain or subdomain
    const msg = err instanceof Error ? err.message : 'update failed';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'That custom domain or subdomain is already taken' },
        { status: 409 },
      );
    }
    throw err;
  }

  // Bust the cached workspace shape used by the navbar/logo.
  invalidateCache(`workspace:${ctx.tenantId}`);

  return NextResponse.json({ ok: true });
=======
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { validateBody } from '@/lib/api/validate';
import { getBrandingForTenant, BrandingConfig } from '@/lib/branding';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
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

/**
 * GET /api/tenant/branding
 * Fetch current branding config for authenticated tenant
 */
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

/**
 * PUT /api/tenant/branding
 * Update branding config. Requires admin role.
 */
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

    // Update direct tenant columns
    const tenantUpdate: Record<string, unknown> = {};
    if (data.logoUrl !== undefined) tenantUpdate['logoUrl'] = data.logoUrl;
    if (data.faviconUrl !== undefined) tenantUpdate['faviconUrl'] = data.faviconUrl;
    if (data.primaryColor !== undefined) tenantUpdate['primaryColor'] = data.primaryColor;
    if (data.customDomain !== undefined) tenantUpdate['customDomain'] = data.customDomain;

    if (Object.keys(tenantUpdate).length > 0) {
      await db.update(tenants)
        .set(tenantUpdate)
        .where(eq(tenants.id, ctx.tenantId));
    }

    // Store extended branding in settings.branding JSONB
    const extendedBranding: Partial<BrandingConfig> = {};
    if (data.secondaryColor !== undefined) extendedBranding.secondaryColor = data.secondaryColor;
    if (data.accentColor !== undefined) extendedBranding.accentColor = data.accentColor;
    if (data.companyName !== undefined) extendedBranding.companyName = data.companyName;
    if (data.hidePoweredBy !== undefined) extendedBranding.hidePoweredBy = data.hidePoweredBy;
    if (data.customCss !== undefined) extendedBranding.customCss = data.customCss;
    if (data.headerLayout !== undefined) extendedBranding.headerLayout = data.headerLayout;

    if (Object.keys(extendedBranding).length > 0) {
      // Get current settings and merge
      const current = await db.select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1);

      const currentSettings = (current[0]?.settings as Record<string, unknown>) ?? {};
      const currentBranding = (currentSettings['branding'] as Record<string, unknown>) ?? {};

      await db.update(tenants)
        .set({
          settings: {
            ...currentSettings,
            branding: { ...currentBranding, ...extendedBranding },
          },
        })
        .where(eq(tenants.id, ctx.tenantId));
    }

    // Return updated branding
    const updatedBranding = await getBrandingForTenant(ctx.tenantId);
    return NextResponse.json({ data: updatedBranding });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[Branding] PUT error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
>>>>>>> main
}
