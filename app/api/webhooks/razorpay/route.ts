import { NextRequest, NextResponse } from 'next/server';
import {
  isRazorpayConfigured,
  verifyWebhookSignature,
  RazorpaySignatureError,
} from '@/lib/razorpay';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';

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
    console.error(`[Razorpay Webhook] Error processing ${eventType}:`, err.message);
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

  const planId = payment.notes?.plan_id || 'starter';

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

  const planId = subscription.notes?.plan_id || 'starter';

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

  // Downgrade to free plan
  await db.update(tenants)
    .set({
      planId: 'free',
      status: 'active',
      subscriptionId: null,
      billingType: 'trial',
      updatedAt: new Date(),
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
