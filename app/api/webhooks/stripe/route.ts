import { NextRequest, NextResponse } from 'next/server';
import { constructWebhookEvent } from '@/lib/stripe';
import { db } from '@/drizzle/db';
import { billingEvents } from '@/drizzle/schema/infra';
import { tenants } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/webhooks/stripe
 * Handles incoming Stripe webhook events.
 * This is a public route (listed in PUBLIC_PATHS in middleware.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
    }

    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    const payload = await req.text();

    let event: { id: string; type: string; data: { object: Record<string, unknown> } };
    try {
      event = constructWebhookEvent(payload, signature, secret);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Signature verification failed';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const obj = event.data.object;
    const metadata = (obj['metadata'] ?? {}) as Record<string, unknown>;
    const tenantId = metadata['tenant_id'] as string | undefined;

    // Store the event in billingEvents table
    if (tenantId) {
      try {
        await db.insert(billingEvents).values({
          tenantId,
          eventType: event.type,
          amount: obj['amount_total'] ? String(Number(obj['amount_total']) / 100) : null,
          currency: (obj['currency'] as string) ?? 'usd',
          stripeEventId: event.id,
          stripeInvoiceId: (obj['invoice'] as string) ?? null,
          stripeSubscriptionId: (obj['subscription'] as string) ?? null,
          metadata: obj,
        });
      } catch {
        // Non-fatal: event logging should not break webhook processing
      }
    }

    // Handle specific event types
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(obj, metadata);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(obj);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(obj);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(obj);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook processing failed';
    console.error('[stripe-webhook] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle checkout.session.completed:
 * Activate the plan or module for the tenant.
 */
async function handleCheckoutCompleted(
  obj: Record<string, unknown>,
  metadata: Record<string, unknown>
): Promise<void> {
  const tenantId = metadata['tenant_id'] as string | undefined;
  if (!tenantId) return;

  const subscriptionId = obj['subscription'] as string | undefined;
  const customerId = obj['customer'] as string | undefined;

  // Update tenant with Stripe IDs
  const updates: Record<string, unknown> = {};
  if (subscriptionId) updates['stripeSubscriptionId'] = subscriptionId;
  if (customerId) updates['stripeCustomerId'] = customerId;

  if (Object.keys(updates).length > 0) {
    await db.update(tenants)
      .set(updates)
      .where(eq(tenants.id, tenantId));
  }

  // If this is a module add-on purchase, activate the module
  const moduleId = metadata['module_id'] as string | undefined;
  const purchaseType = metadata['type'] as string | undefined;
  if (moduleId && purchaseType === 'module_addon') {
    // Module activation is handled via the module registry
    // The tenant can now access the module
    const { ModuleRegistry } = await import('@/lib/modules/registry');
    await ModuleRegistry.install(tenantId, moduleId, 'stripe_webhook');
  }

  // If plan_id is in metadata, update the tenant plan
  const planId = metadata['plan_id'] as string | undefined;
  if (planId) {
    await db.update(tenants)
      .set({ planId, status: 'active' })
      .where(eq(tenants.id, tenantId));
  }
}

/**
 * Handle customer.subscription.updated:
 * Sync the plan with the current subscription status.
 */
async function handleSubscriptionUpdated(obj: Record<string, unknown>): Promise<void> {
  const subscriptionId = obj['id'] as string | undefined;
  if (!subscriptionId) return;

  const status = obj['status'] as string | undefined;
  const metadata = (obj['metadata'] ?? {}) as Record<string, unknown>;
  const tenantId = metadata['tenant_id'] as string | undefined;

  if (!tenantId) return;

  // Map Stripe subscription status to tenant status
  const statusMap: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'past_due',
    trialing: 'trialing',
  };

  const tenantStatus = (status && statusMap[status]) ? statusMap[status] : undefined;
  if (tenantStatus) {
    await db.update(tenants)
      .set({ status: tenantStatus as 'active' | 'past_due' | 'cancelled' | 'trialing' })
      .where(eq(tenants.id, tenantId));
  }
}

/**
 * Handle customer.subscription.deleted:
 * Downgrade the tenant to the free plan.
 */
async function handleSubscriptionDeleted(obj: Record<string, unknown>): Promise<void> {
  const metadata = (obj['metadata'] ?? {}) as Record<string, unknown>;
  const tenantId = metadata['tenant_id'] as string | undefined;

  if (!tenantId) return;

  await db.update(tenants)
    .set({
      planId: 'free',
      status: 'active',
      stripeSubscriptionId: null,
    })
    .where(eq(tenants.id, tenantId));
}

/**
 * Handle invoice.payment_failed:
 * Mark the tenant as past_due.
 */
async function handlePaymentFailed(obj: Record<string, unknown>): Promise<void> {
  const subscriptionId = obj['subscription'] as string | undefined;
  if (!subscriptionId) return;

  // Find tenant by subscription ID
  const metadata = (obj['metadata'] ?? {}) as Record<string, unknown>;
  const tenantId = metadata['tenant_id'] as string | undefined;

  if (tenantId) {
    await db.update(tenants)
      .set({ status: 'past_due' })
      .where(eq(tenants.id, tenantId));
  }
}
