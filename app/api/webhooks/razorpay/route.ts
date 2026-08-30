/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import {
  isRazorpayConfigured,
  verifyWebhookSignature,
  RazorpaySignatureError,
  normalizeRazorpayPlan,
} from '@/lib/razorpay';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { acquireLock } from '@/lib/cache/index';

/** Idempotency window: how long a processed event id blocks re-processing. */
const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24h

/**
 * Razorpay Webhook Handler
 *
 * Processes Razorpay events for subscription lifecycle management.
 * Endpoint: POST /api/webhooks/razorpay
 *
 * Events handled:
 * - payment.captured      -> Activate subscription
 * - subscription.activated -> Update tenant plan
 * - subscription.cancelled -> Downgrade to free
 * - payment.failed         -> Flag tenant as past_due
 */
export async function POST(request: NextRequest) {
  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: 'Razorpay not configured' }, { status: 503 });
  }

  const signature = request.headers.get('x-razorpay-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing x-razorpay-signature header' }, { status: 400 });
  }

  let body: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;

  try {
    body = await request.text();
    await verifyWebhookSignature(body, signature);
    event = JSON.parse(body);
  } catch (err) {
    void logError({ error: err, context: 'webhooks/razorpay signature verification', level: 'warning' });
    if (err instanceof RazorpaySignatureError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    return apiError(err, 'Bad request', 400);
  }

  const eventType: string = event.event;
  const payload = event.payload;

  // L-F: idempotency. Razorpay delivers at-least-once, so a redelivered or
  // replayed event must not re-apply its side effect. Dedup on the delivery's
  // event id (falling back to the payment/subscription entity id), mirroring
  // the Stripe handler. Also enforces a replay window: an event older than the
  // idempotency TTL is refused.
  const razorpayEventId =
    request.headers.get('x-razorpay-event-id') ||
    payload?.payment?.entity?.id ||
    payload?.subscription?.entity?.id ||
    null;

  if (razorpayEventId) {
    const { acquired } = await acquireLock(`razorpay:evt:${razorpayEventId}`, IDEMPOTENCY_TTL);
    if (!acquired) {
      console.log(`[Razorpay Webhook] Duplicate event ${razorpayEventId} — skipping`);
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  console.log(`[Razorpay Webhook] Processing event: ${eventType}`);

  try {
    switch (eventType) {
      case 'payment.captured': {
        await handlePaymentCaptured(payload);
        break;
      }

      case 'subscription.activated': {
        await handleSubscriptionActivated(payload);
        break;
      }

      case 'subscription.cancelled': {
        await handleSubscriptionCancelled(payload);
        break;
      }

      case 'payment.failed': {
        await handlePaymentFailed(payload);
        break;
      }

      default:
        console.log(`[Razorpay Webhook] Unhandled event: ${eventType}`);
    }

    return NextResponse.json({ received: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'webhooks/razorpay event processing', metadata: { eventType } });
    // Return 200 to prevent Razorpay from retrying (we logged the error)
    return NextResponse.json({ received: true });
  }
}

// -- Event Handlers -----------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentCaptured(payload: any) {
  const payment = payload?.payment?.entity;
  if (!payment) return;

  const tenantId = payment.notes?.tenant_id;
  if (!tenantId) {
    console.warn('[Razorpay] payment.captured but no tenant_id in notes');
    return;
  }

  // #1210: map Razorpay plan name (growth/scale) to the canonical id
  // (pro/enterprise) so plan limits match the paid plan.
  const planId = normalizeRazorpayPlan(payment.notes?.plan_id);

  await db.update(tenants)
    .set({
      planId,
      status: 'active',
      billingType: 'razorpay',
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  console.log(`[Razorpay] Tenant ${tenantId} activated with plan ${planId}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionActivated(payload: any) {
  const subscription = payload?.subscription?.entity;
  if (!subscription) return;

  const tenantId = subscription.notes?.tenant_id;
  if (!tenantId) {
    console.warn('[Razorpay] subscription.activated but no tenant_id in notes');
    return;
  }

  // #1210: normalize Razorpay plan name to the canonical app plan id.
  const planId = normalizeRazorpayPlan(subscription.notes?.plan_id);

  await db.update(tenants)
    .set({
      planId,
      status: 'active',
      billingType: 'razorpay',
      subscriptionId: subscription.id,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  console.log(`[Razorpay] Tenant ${tenantId} subscription activated: plan=${planId}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionCancelled(payload: any) {
  const subscription = payload?.subscription?.entity;
  if (!subscription) return;

  const tenantId = subscription.notes?.tenant_id;
  if (!tenantId) {
    console.warn('[Razorpay] subscription.cancelled but no tenant_id in notes');
    return;
  }

  // Downgrade to free plan and mark the subscription cancelled.
  // NOTE: tenants has no dedicated cancelled_at column, so the timestamp is
  // recorded under metadata.cancelled_at (tenants.status becomes 'cancelled').
  await db.update(tenants)
    .set({
      planId: 'free',
      status: 'cancelled',
      subscriptionId: null,
      billingType: 'trial',
      updatedAt: new Date(),
      metadata: sql`COALESCE(${tenants.metadata}, '{}'::jsonb) || ${JSON.stringify({ cancelled_at: new Date().toISOString() })}::jsonb`,
    })
    .where(eq(tenants.id, tenantId));

  console.log(`[Razorpay] Tenant ${tenantId} subscription cancelled - downgraded to free`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentFailed(payload: any) {
  const payment = payload?.payment?.entity;
  if (!payment) return;

  const tenantId = payment.notes?.tenant_id;
  if (!tenantId) {
    console.warn('[Razorpay] payment.failed but no tenant_id in notes');
    return;
  }

  await db.update(tenants)
    .set({
      status: 'past_due',
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  console.log(`[Razorpay] Payment failed for tenant ${tenantId} - marked as past_due`);
}
