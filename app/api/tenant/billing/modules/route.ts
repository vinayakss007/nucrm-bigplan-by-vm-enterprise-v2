import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createModuleCheckoutSession } from '@/lib/stripe';
import { BUILTIN_MODULES } from '@/lib/modules/registry';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const moduleCheckoutSchema = z.object({
  module_id: z.string().min(1),
});

/**
 * POST /api/tenant/billing/modules
 * Creates a Stripe Checkout session for purchasing a module add-on.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });

    const rawBody = await req.json();
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

    const session = await createModuleCheckoutSession(
      ctx.tenantId,
      module_id,
      manifest.name,
      priceInCents,
      {
        customerId: tenant.stripeCustomerId ?? undefined,
        customerEmail: tenant.billingEmail ?? undefined,
      }
    );

    return NextResponse.json({ url: session.url, session_id: session.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
