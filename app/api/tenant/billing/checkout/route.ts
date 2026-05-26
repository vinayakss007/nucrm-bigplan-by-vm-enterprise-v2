/**
 * POST /api/tenant/billing/checkout
 *
 * Creates a Stripe Checkout Session for the requested plan and returns the
 * hosted URL. The billing page redirects the browser to that URL; once the
 * user completes payment Stripe fires `checkout.session.completed` and the
 * webhook persists the customer + subscription IDs.
 *
 * Body: { plan_id: string }
 * Response: { url: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants, users, subscriptions } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import {
  isStripeConfigured,
  priceIdForPlan,
  stripeFetch,
  StripeNotConfiguredError,
  StripeApiError,
  type StripeCheckoutSession,
  type StripeCustomer,
} from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Only workspace admins can change the plan.' }, { status: 403 });
    }

    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Billing is not configured. Contact support to upgrade.' },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const planId: string | undefined = body.plan_id;
    if (!planId || typeof planId !== 'string') {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }

    const priceId = priceIdForPlan(planId);
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for plan "${planId}". Set STRIPE_PRICE_${planId.toUpperCase()} in env.` },
        { status: 400 },
      );
    }

    // Resolve workspace + admin user (for prefilled customer email)
    const [workspace] = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    const [adminUser] = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    // Get-or-create the Stripe customer. We persist the customer ID on the
    // subscriptions row so subsequent checkouts / portal sessions reuse it.
    const customerId = await getOrCreateStripeCustomer({
      tenantId: ctx.tenantId,
      tenantName: workspace.name,
      adminEmail: adminUser?.email,
      adminName: adminUser?.fullName ?? null,
    });

    const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000';

    const session = await stripeFetch<StripeCheckoutSession>('/checkout/sessions', {
      method: 'POST',
      params: {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appUrl}/tenant/settings/billing?upgraded=1`,
        cancel_url: `${appUrl}/tenant/settings/billing?cancelled=1`,
        client_reference_id: ctx.tenantId,
        // metadata flows back through the webhook events
        metadata: {
          tenant_id: ctx.tenantId,
          plan_id: planId,
          initiated_by: ctx.userId,
        },
        subscription_data: {
          metadata: {
            tenant_id: ctx.tenantId,
            plan_id: planId,
          },
        },
        allow_promotion_codes: true,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return NextResponse.json(
        { error: 'Billing is not configured. Contact support to upgrade.' },
        { status: 503 },
      );
    }
    if (err instanceof StripeApiError) {
      console.error('[billing/checkout] stripe error', err.status, err.message);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('[billing/checkout]', err);
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
  }
}

/**
 * Find the existing stripeCustomerId on the subscriptions row, or create a
 * new Stripe customer and persist it. Idempotent: a second call returns the
 * same customer ID.
 */
async function getOrCreateStripeCustomer(args: {
  tenantId: string;
  tenantName: string;
  adminEmail?: string;
  adminName?: string | null;
}): Promise<string> {
  const [existing] = await db
    .select({ id: subscriptions.id, stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, args.tenantId))
    .limit(1);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const created = await stripeFetch<StripeCustomer>('/customers', {
    method: 'POST',
    params: {
      name: args.tenantName,
      email: args.adminEmail,
      metadata: { tenant_id: args.tenantId, admin_user_name: args.adminName ?? '' },
    },
  });

  if (existing) {
    await db
      .update(subscriptions)
      .set({ stripeCustomerId: created.id, updatedAt: new Date() })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      tenantId: args.tenantId,
      stripeCustomerId: created.id,
      status: 'incomplete',
    });
  }

  return created.id;
}
