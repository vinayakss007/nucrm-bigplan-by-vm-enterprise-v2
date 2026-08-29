/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, plans, subscriptions } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { dbCache, invalidateCache } from '@/lib/db/cache';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { withApiRoute } from '@/lib/api/with-api-route';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const tenant = await dbCache(`workspace:${ctx.tenantId}`, 2*60*1000, async () => {
      const [row] = await db.select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        ownerId: tenants.ownerId,
        planId: tenants.planId,
        status: tenants.status,
        logoUrl: tenants.logoUrl,
        primaryColor: tenants.primaryColor,
        industry: tenants.industry,
        companySize: tenants.companySize,
        country: tenants.country,
        settings: tenants.settings,
        subdomain: tenants.subdomain,
        customDomain: tenants.customDomain,
        createdAt: tenants.createdAt,
        updatedAt: tenants.updatedAt,
        plan_name: plans.name,
        max_users: plans.maxUsers,
        max_contacts: plans.maxContacts,
        max_deals: plans.maxDeals,
        features: plans.features,
        // Surface the Stripe customer ID so the billing UI can decide
        // whether to show "Manage Billing" / "Invoices" buttons.
        stripe_customer_id: subscriptions.stripeCustomerId,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
      return row;
    });

    return NextResponse.json({ data: tenant });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { name } = await readJsonBody(request);
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now().toString(36);
    
    const tenant = await db.transaction(async (tx) => {
      const [t] = await tx.insert(tenants).values({
        name: name.trim(),
        slug,
        ownerId: ctx.userId,
        planId: 'free',
        status: 'trialing',
      }).returning();

      if (!t) throw new Error('Failed to create workspace');

      await tx.update(users)
        .set({ lastTenantId: t.id })
        .where(eq(users.id, ctx.userId));

      return t;
    });

    return NextResponse.json({ data: tenant }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});

export const PATCH = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const limited = await checkRateLimit(request, { action: 'settings_update', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const expectedUpdatedAt = body.expectedUpdatedAt ?? body._updated_at;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {};
    
    // Map allowed fields to camelCase
    if (body.name !== undefined) updateData.name = body.name;
    if (body.primary_color !== undefined) updateData.primaryColor = body.primary_color;
    if (body.industry !== undefined) updateData.industry = body.industry;
    if (body.company_size !== undefined) updateData.companySize = body.company_size;
    if (body.country !== undefined) updateData.country = body.country;
    if (body.settings !== undefined) updateData.settings = body.settings;
    if (body.logo_url !== undefined) updateData.logoUrl = body.logo_url;
    if (body.subdomain !== undefined) updateData.subdomain = body.subdomain;
    if (body.custom_domain !== undefined) updateData.customDomain = body.custom_domain;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    }

    updateData.updatedAt = new Date();

    const updatedAtGuard = concurrencyGuard(tenants, expectedUpdatedAt);

    const [tenant] = await db.update(tenants)
      .set(updateData)
      .where(and(eq(tenants.id, ctx.tenantId), ...(updatedAtGuard ? [updatedAtGuard] : [])))
      .returning();

    if (!tenant) return NextResponse.json({ error: 'Conflicts with another update' }, { status: 409 });

    invalidateCache(`workspace:${ctx.tenantId}`);

    return NextResponse.json({ data: tenant });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
