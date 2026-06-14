import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, isStripeConfigured, StripeError } from '@/lib/stripe';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

/**
 * Stripe Webhook Handler
 *
 * Processes Stripe events for subscription lifecycle management.
 * Endpoint: POST /api/webhooks/stripe
 *
 * Events handled:
 * - checkout.session.completed → Activate subscription
 * - customer.subscription.updated → Sync plan changes
 * - customer.subscription.deleted → Downgrade to free
 * - invoice.payment_succeeded → Record payment
 * - invoice.payment_failed → Flag tenant as past_due
 */
export async function POST(request: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;

  try {
    const body = await request.text();
    event = await verifyWebhookSignature(body, signature);
  } catch (err) {
    console.error('[Stripe Webhook] Verification failed:', err);
    if (err instanceof StripeError) {
      return apiError(err, "Bad request", 400);
    }
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const eventType = event.type;
  const data = event.data?.object;

  console.log(`[Stripe Webhook] Processing event: ${eventType}`);

  try {
    switch (eventType) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(data);
        break;
      }

      case 'customer.subscription.updated': {
        await handleSubscriptionUpdated(data);
        break;
      }

      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(data);
        break;
      }

      case 'invoice.payment_succeeded': {
        await handlePaymentSucceeded(data);
        break;
      }

      case 'invoice.payment_failed': {
        await handlePaymentFailed(data);
        break;
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event: ${eventType}`);
    }

    return NextResponse.json({ received: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error processing ${eventType}:`, err.message);
    // Return 200 to prevent Stripe from retrying (we logged the error)
    return NextResponse.json({ received: true }); // error logged via apiError;
  }
}

// ── Event Handlers ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCheckoutCompleted(session: any) {
  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) {
    console.warn('[Stripe] Checkout completed but no tenant_id in metadata');
    return;
  }

  const customerId = session.customer;
  const subscriptionId = session.subscription;

  // Determine plan from price
  const planId = determinePlanFromSession(session);

  await db.update(tenants)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      planId: planId || 'starter',
      status: 'active',
      billingType: 'stripe',
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  console.log(`[Stripe] Tenant ${tenantId} activated with plan ${planId}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionUpdated(subscription: any) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return;

  const status = subscription.status;
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;

  // Map Stripe status to NuCRM status
  let nuCrmStatus = 'active';
  if (status === 'past_due') nuCrmStatus = 'past_due';
  else if (status === 'canceled' || status === 'unpaid') nuCrmStatus = 'cancelled';
  else if (cancelAtPeriodEnd) nuCrmStatus = 'active'; // Still active until period ends

  const planId = determinePlanFromSubscription(subscription);

  await db.update(tenants)
    .set({
      planId: planId || undefined,
      status: nuCrmStatus,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  console.log(`[Stripe] Tenant ${tenantId} subscription updated: status=${nuCrmStatus}, plan=${planId}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionDeleted(subscription: any) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return;

  // Downgrade to free plan
  await db.update(tenants)
    .set({
      planId: 'free',
      status: 'active', // Don't suspend — just downgrade
      stripeSubscriptionId: null,
      billingType: 'trial',
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  console.log(`[Stripe] Tenant ${tenantId} subscription cancelled — downgraded to free`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentSucceeded(invoice: any) {
  const customerId = invoice.customer;
  if (!customerId) return;

  // Find tenant by Stripe customer ID
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.stripeCustomerId, customerId),
    columns: { id: true },
  });

  if (tenant) {
    // Ensure status is active after successful payment
    await db.update(tenants)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    console.log(`[Stripe] Payment succeeded for tenant ${tenant.id}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentFailed(invoice: any) {
  const customerId = invoice.customer;
  if (!customerId) return;

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.stripeCustomerId, customerId),
    columns: { id: true },
  });

  if (tenant) {
    await db.update(tenants)
      .set({ status: 'past_due', updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    console.log(`[Stripe] Payment failed for tenant ${tenant.id} — marked as past_due`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function determinePlanFromSession(session: any): string | null {
  // Try to extract from line items metadata or price lookup
  const amountTotal = session.amount_total; // in cents
  if (!amountTotal) return null;

  // Simple heuristic based on amount (configure properly with price IDs)
  if (amountTotal <= 2900) return 'starter';
  if (amountTotal <= 7900) return 'pro';
  return 'enterprise';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function determinePlanFromSubscription(subscription: any): string | null {
  const priceId = subscription.items?.data?.[0]?.price?.id;
  if (!priceId) return null;

  // Check against configured price IDs
  const starterMonthly = process.env['STRIPE_PRICE_STARTER_MONTHLY'];
  const starterYearly = process.env['STRIPE_PRICE_STARTER_YEARLY'];
  const proMonthly = process.env['STRIPE_PRICE_PRO_MONTHLY'];
  const proYearly = process.env['STRIPE_PRICE_PRO_YEARLY'];
  const enterpriseMonthly = process.env['STRIPE_PRICE_ENTERPRISE_MONTHLY'];
  const enterpriseYearly = process.env['STRIPE_PRICE_ENTERPRISE_YEARLY'];

  if (priceId === starterMonthly || priceId === starterYearly) return 'starter';
  if (priceId === proMonthly || priceId === proYearly) return 'pro';
  if (priceId === enterpriseMonthly || priceId === enterpriseYearly) return 'enterprise';

  return null;
}
