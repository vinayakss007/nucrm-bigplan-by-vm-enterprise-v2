/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requireCsrf } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { billingEvents, subscriptions } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { isStripeConfigured, resumeSubscription } from '@/lib/stripe';
import { deriveSubscriptionActionIdempotencyKey } from '@/lib/billing-idempotency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * POST /api/tenant/billing/subscription/resume
 * Undo a scheduled cancellation. lib/stripe.ts has exported resumeSubscription
 * since it was written, but nothing called it, so the "Resume subscription"
 * button on the billing page had no endpoint to press.
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'billing', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const csrf = requireCsrf(request);
    if (csrf) return csrf;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payment processing is not configured.' }, { status: 503 });
    }

    const currentSub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.tenantId, ctx.tenantId),
    });

    if (!currentSub) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
    }
    if (!currentSub.stripeSubscriptionId) {
      return NextResponse.json(
        { error: 'No Stripe subscription found. Please contact support.' },
        { status: 400 }
      );
    }
    if (currentSub.status === 'canceled') {
      return NextResponse.json(
        { error: 'This subscription has already ended. Start a new one instead.' },
        { status: 400 }
      );
    }
    if (!currentSub.cancelAtPeriodEnd) {
      return NextResponse.json({ error: 'Subscription is not scheduled to cancel' }, { status: 400 });
    }

    // #2228: deterministic idempotency key — retrying this POST cannot
    // replay as a second mutation against Stripe.
    const idempotencyKey = deriveSubscriptionActionIdempotencyKey(
      'resume',
      ctx.tenantId,
      currentSub.stripeSubscriptionId,
    );
    const stripeSub = await resumeSubscription(currentSub.stripeSubscriptionId, idempotencyKey);

    await db.transaction(async (tx) => {
      await tx.update(subscriptions).set({
        status: 'active',
        cancelAtPeriodEnd: false,
        metadata: {
          ...(currentSub.metadata as Record<string, unknown> || {}),
          resumed_at: new Date().toISOString(),
          resumed_by: ctx.userId,
        },
      }).where(eq(subscriptions.id, currentSub.id));

      await tx.insert(billingEvents).values({
        tenantId: ctx.tenantId,
        eventType: 'subscription.resumed',
        currency: 'usd',
        stripeSubscriptionId: currentSub.stripeSubscriptionId,
        metadata: {
          plan_id: currentSub.planId || 'none',
          resumed_by: ctx.userId,
        },
      });
    });

    return NextResponse.json({
      data: {
        subscriptionId: currentSub.id,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: stripeSub.current_period_end
          ? new Date(stripeSub.current_period_end * 1000).toISOString()
          : null,
        message: 'Subscription resumed — it will continue after the current period',
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
});
