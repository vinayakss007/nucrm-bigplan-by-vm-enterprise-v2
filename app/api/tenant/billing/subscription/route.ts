/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions, plans, billingEvents } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * GET /api/tenant/billing/subscription
 * Returns current subscription with plan details, usage, and billing history.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Get current subscription
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, ctx.tenantId),
    });

    if (!subscription) {
      return NextResponse.json({ 
        data: null,
        message: 'No active subscription found' 
      });
    }

    // Get plan details separately
    const plan = subscription.planId 
      ? await db.query.plans.findFirst({
          where: eq(plans.id, subscription.planId),
        })
      : null;

    // Get recent billing events
    const recentEvents = await db.query.billingEvents.findMany({
      where: eq(billingEvents.tenantId, ctx.tenantId),
      orderBy: [desc(billingEvents.createdAt)],
      limit: 10,
    });

    return NextResponse.json({
      data: {
        subscription: {
          id: subscription.id,
          status: subscription.status,
          planId: subscription.planId,
          planName: plan?.name || 'Unknown',
          planPrice: plan?.priceMonthly || 0,
          planFeatures: plan?.features || [],
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          stripeCustomerId: subscription.stripeCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        },
        plan: plan ? {
          id: plan.id,
          name: plan.name,
          slug: plan.slug,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          maxUsers: plan.maxUsers,
          maxContacts: plan.maxContacts,
          maxDeals: plan.maxDeals,
          maxStorageGb: plan.maxStorageGb,
          maxAutomations: plan.maxAutomations,
          maxForms: plan.maxForms,
          maxApiCallsDay: plan.maxApiCallsDay,
          features: plan.features,
        } : null,
        recentEvents: recentEvents.map(e => ({
          id: e.id,
          eventType: e.eventType,
          amount: e.amount,
          currency: e.currency,
          createdAt: e.createdAt,
        })),
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
});
