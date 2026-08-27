/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, isStripeConfigured, StripeError, type StripeWebhookEvent } from '@/lib/stripe';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { sendAdminTelegram } from '@/lib/telegram-admin';
import { acquireLock } from '@/lib/cache/index';
import { fireWebhooks } from '@/lib/webhooks';
import { logError } from '@/lib/errors-server';

const IDEMPOTENCY_TTL = 3600 * 24; // 24 hours

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

  // #1287: verifyWebhookSignature returns a typed StripeWebhookEvent, so the
  // envelope fields (id/type/data.object) are checked rather than bare `any`.
  let event: StripeWebhookEvent;

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
  const eventId = event.id;

  // ── Idempotency check ──────────────────────────────────────────────────────
  // Stripe guarantees at-least-once delivery; prevent duplicate processing
  const lockKey = `stripe:evt:${eventId}`;
  const { acquired } = await acquireLock(lockKey, IDEMPOTENCY_TTL);
  if (!acquired) {
    console.log(`[Stripe Webhook] Duplicate event ${eventId} — skipping`);
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log(`[Stripe Webhook] Processing event: ${eventType} (${eventId})`);

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
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error processing ${eventType}:`, err.message);
    // Return 500 so Stripe retries — critical for subscription activations
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

// ── Event Handlers ───────────────────────────────────────────────────────────

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCheckoutCompleted(session: any) {
  const tenantId = session.metadata?.tenant_id;
  if (!tenantId) {
    console.warn('[Stripe] Checkout completed but no tenant_id in metadata');
    return;
  }

  const customerId = session.customer;
  const subscriptionId = session.subscription;

  // Determine plan using the most reliable method available:
  // 1. Try subscription object (price ID mapping)
  // 2. Try line_items price ID
  // 3. Fall back to amount heuristic (last resort)
  const planId = determinePlanFromCheckoutSession(session);

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
async function handleSubscriptionUpdated(subscription: any) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return;

  const status = subscription.status;
  const cancelAtPeriodEnd = subscription.cancel_at_period_end;

  // Map Stripe subscription status to a NuCRM tenant status EXPLICITLY, with a
  // safe non-active default. Unknown/terminal Stripe statuses must NOT fall
  // through to 'active' (that would keep dead subscriptions on paid access).
  //   - active / trialing (and the still-active cancel_at_period_end case)
  //     -> 'active'
  //   - past_due                                   -> 'past_due'
  //   - canceled / unpaid / incomplete_expired     -> 'cancelled' (terminal)
  //   - incomplete / paused / anything unknown     -> 'cancelled' (non-active)
  // 'cancelled' is the established terminal value used by the Razorpay handler
  // (#1262) and the tenant status enum, so we reuse it for the non-active
  // default rather than inventing a new value.
  let nuCrmStatus: string;
  if (status === 'active' || status === 'trialing') {
    nuCrmStatus = 'active';
  } else if (status === 'past_due') {
    nuCrmStatus = 'past_due';
  } else if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') {
    nuCrmStatus = 'cancelled';
  } else if (cancelAtPeriodEnd) {
    // Scheduled to cancel but still within the paid period — keep access.
    nuCrmStatus = 'active';
  } else {
    // incomplete, paused, or any future/unknown Stripe status: fail safe to a
    // non-active status so we never grant paid access by default.
    nuCrmStatus = 'cancelled';
  }

  const planId = determinePlanFromSubscription(subscription);

  // Do NOT clobber an admin-imposed terminal status. If a tenant was manually
  // suspended or cancelled, a routine subscription.updated event must not
  // silently reactivate it. Only guard the elevation to 'active'; genuine
  // downgrades (past_due/cancelled) are still allowed to apply.
  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { status: true },
  });
  const currentStatus = existing?.status;
  if (nuCrmStatus === 'active' && (currentStatus === 'suspended' || currentStatus === 'cancelled')) {
    console.log(`[Stripe] Tenant ${tenantId} is ${currentStatus} (admin-set) — skipping reactivation to active, plan=${planId}`);
    if (planId) {
      await db.update(tenants)
        .set({ planId, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
    }
    return;
  }

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

    fireWebhooks(tenant.id, 'invoice.paid', {
      stripe_invoice_id: invoice.id,
      amount_paid: invoice.amount_paid,
      customer: invoice.customer,
    }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

    try {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      evaluateAutomations({
        tenantId: tenant.id,
        event: 'invoice.paid',
        data: {
          stripe_invoice_id: invoice.id,
          amount_paid: invoice.amount_paid,
          customer: invoice.customer,
        },
      }).catch(err => console.error('[Stripe] invoice.paid automation failed:', err));
    } catch (e) {
      console.error('[Stripe] automation import failed:', e);
    }

    console.log(`[Stripe] Payment succeeded for tenant ${tenant.id}`);
  }
}

 
 
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

    sendAdminTelegram({
      icon: '💳',
      title: 'Payment Failed',
      message: `Tenant: \`${tenant.id}\`\nAmount: ${invoice.amount_paid ? `$${(invoice.amount_paid / 100).toFixed(2)}` : 'N/A'}\nStatus: past_due`,
    }).catch((e) => console.error('[stripe webhook] Error:', e));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function determinePlanFromCheckoutSession(session: any): string | null {
  // Strategy 1: If the subscription is expanded (object with items), use price ID mapping
  const subscription = session.subscription;
  if (subscription && typeof subscription === 'object') {
    const plan = determinePlanFromSubscription(subscription);
    if (plan) return plan;
  }

  // Strategy 2: Extract price ID from session line_items (if expanded on the session)
  const lineItems = session.line_items?.data;
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    const priceId = lineItems[0]?.price?.id;
    if (priceId) {
      const plan = determinePlanFromPriceId(priceId);
      if (plan) return plan;
    }
  }

  // Strategy 3 (last-resort fallback): Amount-based heuristic.
  // WARNING: This is fragile and will break if prices change. It exists only as a
  // safety net when Stripe does not expand subscription or line_items on the session.
  const amountTotal = session.amount_total; // in cents
  if (!amountTotal) return null;

  if (amountTotal <= 2900) return 'starter';
  if (amountTotal <= 7900) return 'pro';
  return 'enterprise';
}

/**
 * Map a Stripe price ID to a NuCRM plan using environment variable configuration.
 */
function determinePlanFromPriceId(priceId: string): string | null {
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
