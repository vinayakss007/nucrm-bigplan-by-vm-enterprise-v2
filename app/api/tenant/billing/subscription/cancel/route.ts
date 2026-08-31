/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions, billingEvents } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { cancelSubscription, isStripeConfigured } from '@/lib/stripe';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const cancelSchema = z.object({
  reason: z.string().optional(),
  feedback: z.enum(['too_expensive', 'missing_features', 'poor_support', 'switching_competitor', 'other']).optional(),
  cancelAtPeriodEnd: z.boolean().optional().default(true),
});

/**
 * POST /api/tenant/billing/subscription/cancel
 * Cancel subscription (either immediately or at period end).
 * 
 * Body: { reason?: string, feedback?: string, cancelAtPeriodEnd?: boolean }
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
    const parsed = validateBody(cancelSchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { reason, feedback, cancelAtPeriodEnd } = parsed.data;

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

    if (currentSub.status === 'canceled') {
      return NextResponse.json({ error: 'Subscription is already cancelled' }, { status: 400 });
    }

    // Cancel in Stripe
    const stripeSub = await cancelSubscription(currentSub.stripeSubscriptionId, cancelAtPeriodEnd);

    // Update subscription in database
    const updateData: {
      status: string;
      cancelAtPeriodEnd: boolean;
      metadata: Record<string, unknown>;
      canceledAt?: Date;
    } = {
      status: cancelAtPeriodEnd ? 'active' : 'canceled',
      cancelAtPeriodEnd: cancelAtPeriodEnd,
      metadata: {
        ...(currentSub.metadata as Record<string, unknown> || {}),
        cancelled_at: new Date().toISOString(),
        cancelled_by: ctx.userId,
        cancellation_reason: reason || 'not_specified',
        cancellation_feedback: feedback || 'not_specified',
      },
    };

    if (!cancelAtPeriodEnd) {
      updateData.canceledAt = new Date();
    }

    await db.transaction(async (tx) => {
      await tx.update(subscriptions).set(updateData).where(eq(subscriptions.id, currentSub.id));

      await tx.insert(billingEvents).values({
        tenantId: ctx.tenantId,
        eventType: cancelAtPeriodEnd ? 'subscription.cancel_scheduled' : 'subscription.cancelled',
        amount: currentSub.planId ? '0' : undefined,
        currency: 'usd',
        stripeSubscriptionId: currentSub.stripeSubscriptionId,
        metadata: {
          plan_id: currentSub.planId || 'none',
          cancel_at_period_end: cancelAtPeriodEnd,
          reason: reason || 'not_specified',
          feedback: feedback || 'not_specified',
          cancelled_by: ctx.userId,
        },
      });
    });

    // Calculate data retention date (30 days after cancellation)
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() + 30);

    return NextResponse.json({
      data: {
        subscriptionId: currentSub.id,
        status: cancelAtPeriodEnd ? 'active_until_period_end' : 'canceled',
        cancelAtPeriodEnd: cancelAtPeriodEnd,
        currentPeriodEnd: stripeSub.current_period_end 
          ? new Date(stripeSub.current_period_end * 1000).toISOString()
          : null,
        dataRetentionUntil: retentionDate.toISOString(),
        message: cancelAtPeriodEnd 
          ? 'Subscription will be cancelled at the end of the current billing period'
          : 'Subscription has been cancelled immediately',
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
});
