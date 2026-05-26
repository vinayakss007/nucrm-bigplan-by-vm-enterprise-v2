import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants, billingEvents, subscriptions } from '@/drizzle/schema';
import { eq, and, or, inArray } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'crypto';
import { alertSuperAdmin } from '@/lib/email/service';

function verifyStripeSignature(payload: string, header: string, secret: string): boolean {
  try {
    const parts = header.split(',').reduce((acc: Record<string,string>, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    const ts = parts['t'];
    const sig = parts['v1'];
    if (!ts || !sig) return false;
    // Reject events older than 5 minutes
    if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch { return false; }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sigHeader = request.headers.get('stripe-signature') ?? '';
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  if (!sigHeader || !verifyStripeSignature(body, sigHeader, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(body); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const obj = event.data?.object ?? {};

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Fired when a customer finishes the hosted checkout. Persist the
        // customer + subscription IDs so future portal sessions and webhooks
        // can resolve them. The subscriptions row was inserted with the
        // customer ID at checkout time; here we fill in the rest.
        const tenantId = obj.metadata?.tenant_id ?? obj.client_reference_id;
        const planId = obj.metadata?.plan_id;
        const stripeCustomerId = typeof obj.customer === 'string' ? obj.customer : obj.customer?.id;
        const stripeSubscriptionId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;

        if (tenantId && stripeCustomerId) {
          const [existing] = await db
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(eq(subscriptions.tenantId, tenantId))
            .limit(1);

          const subValues = {
            tenantId,
            planId: planId || undefined,
            status: 'active',
            stripeCustomerId,
            stripeSubscriptionId: stripeSubscriptionId || null,
            cancelAtPeriodEnd: false,
            updatedAt: new Date(),
          };

          if (existing) {
            await db.update(subscriptions).set(subValues).where(eq(subscriptions.id, existing.id));
          } else {
            await db.insert(subscriptions).values(subValues);
          }

          if (planId) {
            await db
              .update(tenants)
              .set({ planId, status: 'active', updatedAt: new Date() })
              .where(eq(tenants.id, tenantId));
          }

          await db.insert(billingEvents).values({
            tenantId,
            eventType: 'checkout.session.completed',
            stripeEventId: event.id,
            stripeSubscriptionId: stripeSubscriptionId || null,
            metadata: { plan_id: planId, customer: stripeCustomerId },
          });
        }
        break;
      }

      case 'invoice.paid': {
        const tenantId = obj.metadata?.tenant_id;
        
        await db.insert(billingEvents).values({
          tenantId: tenantId || null,
          eventType: 'invoice.paid',
          amount: String((obj.amount_paid || 0) / 100),
          stripeEventId: event.id,
          stripeInvoiceId: obj.id,
          stripeSubscriptionId: obj.subscription,
          metadata: obj,
        });

        if (tenantId) {
          await db.update(tenants)
            .set({ status: 'active', updatedAt: new Date() })
            .where(and(
              eq(tenants.id, tenantId),
              inArray(tenants.status, ['trialing', 'trial_expired', 'past_due'])
            ));
        }
        break;
      }

      case 'customer.subscription.updated': {
        // Three states matter here:
        //   1. status='active' + cancel_at_period_end=true:
        //        user clicked "Cancel" in the portal. Subscription stays
        //        active (paid features keep working) until current_period_end.
        //   2. status='active' + cancel_at_period_end=false:
        //        either a fresh subscription, or the user un-cancelled.
        //   3. status='canceled' / 'incomplete_expired':
        //        subscription is over, drop the tenant to the free plan.
        const tenantId = obj.metadata?.tenant_id;
        const planId = obj.metadata?.plan_id;

        if (tenantId) {
          const statusMap: Record<string, string> = {
            'active': 'active',
            'past_due': 'past_due',
            'canceled': 'cancelled',
            'unpaid': 'past_due',
            'incomplete_expired': 'cancelled',
          };
          const stripeStatus = obj.status as string;
          const newTenantStatus = statusMap[stripeStatus];
          const cancelAtPeriodEnd = obj.cancel_at_period_end === true;
          const periodStart = obj.current_period_start
            ? new Date(obj.current_period_start * 1000)
            : null;
          const periodEnd = obj.current_period_end
            ? new Date(obj.current_period_end * 1000)
            : null;
          const isExpired = stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired';

          // Mirror everything onto the subscriptions row first
          const subValues = {
            tenantId,
            status: stripeStatus,
            planId: planId || undefined,
            stripeSubscriptionId: obj.id as string,
            stripeCustomerId:
              typeof obj.customer === 'string' ? obj.customer : obj.customer?.id ?? null,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd,
            updatedAt: new Date(),
          };
          const [existingSub] = await db
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(eq(subscriptions.tenantId, tenantId))
            .limit(1);
          if (existingSub) {
            await db.update(subscriptions).set(subValues).where(eq(subscriptions.id, existingSub.id));
          } else {
            await db.insert(subscriptions).values(subValues);
          }

          // Then reflect onto the tenants row. When the subscription has
          // truly ended, snap the tenant back to the free plan so plan
          // limits re-take effect.
          await db
            .update(tenants)
            .set({
              status: newTenantStatus || undefined,
              planId: isExpired ? 'free' : planId || undefined,
              updatedAt: new Date(),
            })
            .where(eq(tenants.id, tenantId));

          await db.insert(billingEvents).values({
            tenantId,
            eventType: 'subscription_updated',
            stripeEventId: event.id,
            stripeSubscriptionId: obj.id,
            metadata: {
              status: stripeStatus,
              plan_id: planId,
              cancel_at_period_end: cancelAtPeriodEnd,
              current_period_end: obj.current_period_end ?? null,
            },
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        // Final state — Stripe has fully cleaned the subscription up. Drop
        // the tenant back to the free plan and clear the subscription ID
        // so the portal won't surface a stale link.
        const tenantId = obj.metadata?.tenant_id;
        if (tenantId) {
          await db
            .update(tenants)
            .set({ status: 'cancelled', planId: 'free', updatedAt: new Date() })
            .where(eq(tenants.id, tenantId));

          await db
            .update(subscriptions)
            .set({
              status: 'canceled',
              planId: 'free',
              stripeSubscriptionId: null,
              cancelAtPeriodEnd: false,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.tenantId, tenantId));
        }
        await db.insert(billingEvents).values({
          tenantId: tenantId || null,
          eventType: 'cancelled',
          stripeEventId: event.id,
          stripeSubscriptionId: obj.id,
          metadata: obj,
        });
        break;
      }

      case 'payment_intent.payment_failed': {
        const tenantId = obj.metadata?.tenant_id;
        if (tenantId) {
          await db.update(tenants)
            .set({ status: 'past_due', updatedAt: new Date() })
            .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'active')));
        }
        await db.insert(billingEvents).values({
          tenantId: tenantId || null,
          eventType: 'payment_failed',
          stripeEventId: event.id,
          metadata: obj,
        });
        
        await alertSuperAdmin('Payment Failed', `Stripe event: ${event.id}\nTenant: ${tenantId || 'unknown'}\nAmount: $${(obj.amount || 0) / 100}`).catch(() => {});
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[stripe webhook]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
