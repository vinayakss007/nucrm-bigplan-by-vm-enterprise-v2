/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { safeApiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { createCheckoutSession } from '@/lib/stripe';
import { BUILTIN_MODULES } from '@/lib/modules/registry';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

const moduleCheckoutSchema = z.object({
  module_id: z.string().min(1),
});

/**
 * POST /api/tenant/billing/modules
 * Creates a Stripe Checkout session for purchasing a module add-on.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const rateLimited = await rateLimitMutating(req, 'billing', 'post');
    if (rateLimited) return rateLimited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const permErr = requirePerm(ctx, 'billing.manage');
    if (permErr) return permErr;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });

    const rawBody = await readJsonBody(req);
    const validated = validateBody(moduleCheckoutSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { module_id } = validated.data;

    // Verify module exists and has a price
    const manifest = BUILTIN_MODULES.find(m => m.id === module_id);
    if (!manifest) {
      return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    }

    // Get tenant info for plan-based pricing
    const [tenant] = await db.select({
      id: tenants.id,
      planId: tenants.planId,
      stripeCustomerId: tenants.stripeCustomerId,
      billingEmail: tenants.billingEmail,
    })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Determine price from module pricing for the tenant's plan
    const planPricing = manifest.pricing[tenant.planId ?? 'free'];
    if (!planPricing || !planPricing.enabled) {
      return NextResponse.json({ error: 'Module not available on your current plan' }, { status: 403 });
    }

    const priceInCents = (planPricing.price ?? 0) * 100;
    if (priceInCents <= 0) {
      return NextResponse.json({ error: 'Module is free on your plan, no payment needed' }, { status: 400 });
    }

    const session = await createCheckoutSession({
      tenantId: ctx.tenantId,
      customerId: tenant.stripeCustomerId ?? undefined,
      customerEmail: !tenant.stripeCustomerId ? (tenant.billingEmail ?? undefined) : undefined,
      // #3583: no Stripe Price exists for module add-ons (there is no module
      // price catalog in .env.example), so a fabricated module price id was
      // rejected by Stripe on every call. Use inline price_data with the price computed
      // from the module manifest above; module prices are whole USD/month.
      priceData: {
        currency: 'usd',
        unitAmount: priceInCents,
        productName: `${manifest.name} add-on`,
        recurringInterval: 'month',
      },
      mode: 'subscription',
      metadata: { module_id, type: 'module_addon' },
    });

    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (err: unknown) {
    return safeApiError(err); // #2527
  }
});
