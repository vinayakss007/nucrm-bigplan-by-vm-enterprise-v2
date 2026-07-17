import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions, billingEvents } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * GET /api/tenant/billing/subscription
 * Returns current subscription with plan details, usage, and billing history.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Get current subscription with plan details
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, ctx.tenantId),
      with: {
        plan: true,
      },
    });

    if (!subscription) {
      return NextResponse.json({ 
        data: null,
        message: 'No active subscription found' 
      });
    }

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
          planName: subscription.plan?.name || 'Unknown',
          planPrice: subscription.plan?.priceMonthly || 0,
          planFeatures: subscription.plan?.features || [],
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          stripeCustomerId: subscription.stripeCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
        },
        plan: subscription.plan ? {
          id: subscription.plan.id,
          name: subscription.plan.name,
          slug: subscription.plan.slug,
          description: subscription.plan.description,
          priceMonthly: subscription.plan.priceMonthly,
          priceYearly: subscription.plan.priceYearly,
          maxUsers: subscription.plan.maxUsers,
          maxContacts: subscription.plan.maxContacts,
          maxDeals: subscription.plan.maxDeals,
          maxStorageGb: subscription.plan.maxStorageGb,
          maxAutomations: subscription.plan.maxAutomations,
          maxForms: subscription.plan.maxForms,
          maxApiCallsDay: subscription.plan.maxApiCallsDay,
          features: subscription.plan.features,
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
}
