/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions, plans, billingEvents } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateSubscription, getPriceId, isStripeConfigured } from '@/lib/stripe';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const downgradeSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
});

/**
 * POST /api/tenant/billing/subscription/downgrade
 * Schedule a downgrade to take effect at the end of the current billing period.
 * 
 * Body: { planId: string }
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'billing', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(request); // #1835: in-handler CSRF defense-in-depth (after auth)
    if (csrf) return csrf;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payment processing is not configured.' }, { status: 503 });
    }

    const raw = await readJsonBody(request);
    const parsed = validateBody(downgradeSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { planId } = parsed.data;

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

    // Get current plan to verify downgrade
    const currentPlan = await db.query.plans.findFirst({
      where: eq(plans.id, currentSub.planId || ''),
    });

    if (currentPlan && (Number(newPlan.priceMonthly) || 0) >= (Number(currentPlan.priceMonthly) || 0)) {
      return NextResponse.json({ error: 'This is not a downgrade. Use upgrade endpoint instead.' }, { status: 400 });
    }

    // Get Stripe price ID for the new plan
    const priceId = getPriceId(planId, 'month'); // Downgrades are always monthly
    if (!priceId) {
      return NextResponse.json({ error: `Price not configured for ${planId}. Contact support.` }, { status: 500 });
    }

    // Schedule the downgrade at period end
    // In Stripe, this means updating the subscription with proration_behavior: 'none'
    // and setting the new price to take effect at period end
    const stripeSub = await updateSubscription(currentSub.stripeSubscriptionId, {
      metadata: {
        tenant_id: ctx.tenantId,
        pending_plan_id: planId,
        scheduled_downgrade: 'true',
        downgraded_by: ctx.userId,
      },
    });

    // Update subscription in database to reflect pending downgrade
    await db.transaction(async (tx) => {
      await tx.update(subscriptions).set({
        metadata: {
          ...(currentSub.metadata as Record<string, unknown> || {}),
          pending_plan_id: planId,
          scheduled_downgrade: true,
          scheduled_downgrade_at: new Date(stripeSub.current_period_end * 1000).toISOString(),
          downgraded_by: ctx.userId,
        },
      }).where(eq(subscriptions.id, currentSub.id));

      // Record billing event
      await tx.insert(billingEvents).values({
        tenantId: ctx.tenantId,
        eventType: 'subscription.downgrade_scheduled',
        amount: String(newPlan.priceMonthly || '0'),
        currency: 'usd',
        stripeSubscriptionId: currentSub.stripeSubscriptionId,
        metadata: {
          previous_plan_id: currentSub.planId || 'none',
          new_plan_id: planId,
          effective_at: new Date(stripeSub.current_period_end * 1000).toISOString(),
          downgraded_by: ctx.userId,
        },
      });
    });

    return NextResponse.json({
      data: {
        subscriptionId: currentSub.id,
        currentPlanId: currentSub.planId,
        pendingPlanId: planId,
        pendingPlanName: newPlan.name,
        effectiveAt: new Date(stripeSub.current_period_end * 1000).toISOString(),
        message: `Downgrade to ${newPlan.name} scheduled for end of current billing period`,
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
});
