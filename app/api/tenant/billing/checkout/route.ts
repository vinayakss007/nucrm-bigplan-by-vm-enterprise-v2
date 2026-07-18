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
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { createCheckoutSession, createPortalSession, getPriceId, isStripeConfigured } from '@/lib/stripe';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';

const checkoutSchema = z.object({
  plan: z.enum(['starter', 'pro', 'enterprise'], { message: 'Invalid plan. Choose starter, pro, or enterprise.' }),
  interval: z.enum(['month', 'year']).optional().default('month'),
});

/**
 * POST /api/tenant/billing/checkout
 * Creates a Stripe Checkout session for subscription upgrade.
 *
 * Body: { plan: 'starter' | 'pro' | 'enterprise', interval?: 'month' | 'year' }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payment processing is not configured. Contact support.' }, { status: 503 });
    }

    const raw = await request.json();
    const parsed = validateBody(checkoutSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { plan, interval } = parsed.data;

    const priceId = getPriceId(plan, interval);
    if (!priceId) {
      return NextResponse.json({ error: `Price not configured for ${plan}/${interval}. Contact support.` }, { status: 500 });
    }

    // Get tenant info for checkout
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, ctx.tenantId),
      columns: { id: true, stripeCustomerId: true, billingEmail: true, name: true },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const session = await createCheckoutSession({
      tenantId: ctx.tenantId,
      customerId: tenant.stripeCustomerId || undefined,
      customerEmail: !tenant.stripeCustomerId ? (tenant.billingEmail || undefined) : undefined,
      priceId,
      mode: 'subscription',
      trialDays: undefined, // No trial for plan upgrades
      metadata: { plan, interval, user_id: ctx.userId },
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * GET /api/tenant/billing/checkout?action=portal
 * Creates a Stripe Customer Portal session for managing billing.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payment processing is not configured.' }, { status: 503 });
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, ctx.tenantId),
      columns: { stripeCustomerId: true },
    });

    if (!tenant?.stripeCustomerId) {
      return NextResponse.json({ error: 'No billing account found. Subscribe to a plan first.' }, { status: 400 });
    }

    const session = await createPortalSession(tenant.stripeCustomerId);
    return NextResponse.json({ url: session.url });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
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
