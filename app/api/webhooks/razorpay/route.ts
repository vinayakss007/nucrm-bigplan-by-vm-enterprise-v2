/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
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

const IDEMPOTENCY_TTL = 3600 * 24; // 24 hours

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
    console.error('[Razorpay Webhook] Verification failed:', err);
    if (err instanceof RazorpaySignatureError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    return apiError(err, 'Bad request', 400);
  }

  const eventType: string = event.event;
  const payload = event.payload;

  // ── Idempotency check (#1274) ──────────────────────────────────────────────
  // Razorpay delivers webhooks at-least-once and retries on non-2xx / timeouts,
  // so a duplicate delivery must not reprocess (e.g. re-activate a subscription).
  // Mirror the Stripe handler: derive a stable unique id, take a short-lived
  // lock, and skip when the lock is already held. Razorpay has no top-level
  // event.id; the reliable unique key is the x-razorpay-event-id request header,
  // falling back to a composite of the event name + the entity id in the payload.
  const eventId = resolveRazorpayEventId(request, eventType, payload);
  const lockKey = `razorpay:evt:${eventId}`;
  const { acquired } = await acquireLock(lockKey, IDEMPOTENCY_TTL);
  if (!acquired) {
    console.log(`[Razorpay Webhook] Duplicate event ${eventId} — skipping`);
    return NextResponse.json({ received: true, duplicate: true });
  }

  console.log(`[Razorpay Webhook] Processing event: ${eventType} (${eventId})`);

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
    console.error(`[Razorpay Webhook] Error processing ${eventType}:`, err.message);
    // Return 200 to prevent Razorpay from retrying (we logged the error)
    return NextResponse.json({ received: true });
  }
}

/**
 * Resolve a stable unique identifier for a Razorpay webhook delivery so
 * duplicate retries can be deduplicated. Prefers the `x-razorpay-event-id`
 * request header (Razorpay's per-event id). When absent, falls back to a
 * composite of the event name and the primary entity id inside the payload
 * (payment / subscription / order / refund / invoice), which is stable across
 * retries of the same logical event.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveRazorpayEventId(request: NextRequest, eventType: string, payload: any): string {
  const headerId = request.headers.get('x-razorpay-event-id');
  if (headerId) return headerId;

  const entityId =
    payload?.payment?.entity?.id ??
    payload?.subscription?.entity?.id ??
    payload?.order?.entity?.id ??
    payload?.refund?.entity?.id ??
    payload?.invoice?.entity?.id ??
    'unknown';
  return `${eventType}:${entityId}`;
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
