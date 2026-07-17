import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions, plans, billingEvents } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
import { updateSubscription, getPriceId, isStripeConfigured } from '@/lib/stripe';

const upgradeSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  interval: z.enum(['month', 'year']).optional().default('month'),
});

/**
 * POST /api/tenant/billing/subscription/upgrade
 * Upgrade to a higher plan with proration.
 * 
 * Body: { planId: string, interval?: 'month' | 'year' }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payment processing is not configured.' }, { status: 503 });
    }

    const raw = await request.json();
    const parsed = validateBody(upgradeSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { planId, interval } = parsed.data;

    // Get current subscription
    const currentSub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, ctx.tenantId),
    });

    if (!currentSub) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    if (!currentSub.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No Stripe subscription found. Please contact support.' }, { status: 400 });
    }

    // Get the new plan
    const newPlan = await db.query.plans.findFirst({
      where: eq(plans.id, planId),
    });

    if (!newPlan) {
      return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    // Get current plan to verify upgrade
    const currentPlan = await db.query.plans.findFirst({
      where: eq(plans.id, currentSub.planId || ''),
    });

    if (currentPlan && newPlan.priceMonthly <= currentPlan.priceMonthly) {
      return NextResponse.json({ error: 'This is not an upgrade. Use downgrade endpoint instead.' }, { status: 400 });
    }

    // Get Stripe price ID
    const priceId = getPriceId(planId, interval);
    if (!priceId) {
      return NextResponse.json({ error: `Price not configured for ${planId}/${interval}. Contact support.` }, { status: 500 });
    }

    // Update subscription in Stripe (proration happens automatically)
    const stripeSub = await updateSubscription(currentSub.stripeSubscriptionId, {
      priceId,
      metadata: {
        tenant_id: ctx.tenantId,
        plan_id: planId,
        interval,
        upgraded_by: ctx.userId,
      },
    });

    // Update subscription in database
    await db.update(subscriptions).set({
      planId: planId,
      status: 'active',
      currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
      cancelAtPeriodEnd: false,
      metadata: {
        ...currentSub.metadata,
        upgraded_at: new Date().toISOString(),
        upgraded_by: ctx.userId,
        previous_plan_id: currentSub.planId,
      },
    }).where(eq(subscriptions.id, currentSub.id));

    // Record billing event
    await db.insert(billingEvents).values({
      tenantId: ctx.tenantId,
      eventType: 'subscription.upgraded',
      amount: newPlan.priceMonthly,
      currency: 'usd',
      stripeSubscriptionId: currentSub.stripeSubscriptionId,
      metadata: {
        previous_plan_id: currentSub.planId || 'none',
        new_plan_id: planId,
        interval,
        upgraded_by: ctx.userId,
      },
    });

    return NextResponse.json({
      data: {
        subscriptionId: currentSub.id,
        planId: planId,
        planName: newPlan.name,
        status: 'active',
        currentPeriodEnd: stripeSub.current_period_end,
        message: `Successfully upgraded to ${newPlan.name}`,
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
}
