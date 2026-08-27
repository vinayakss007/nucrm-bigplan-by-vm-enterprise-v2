/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions, dunningAttempts, dunningSettings, billingEvents } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { isStripeConfigured } from '@/lib/stripe';

const retrySchema = z.object({
  subscriptionId: z.string().uuid('Invalid subscription ID'),
});

/**
 * POST /api/tenant/billing/dunning/retry
 * Manually retry a failed payment for a subscription.
 * 
 * Body: { subscriptionId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payment processing is not configured.' }, { status: 503 });
    }

    const raw = await readJsonBody(request);
    const parsed = validateBody(retrySchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { subscriptionId } = parsed.data;

    // Get subscription
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, subscriptionId),
    });

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    if (subscription.tenantId !== ctx.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!subscription.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No Stripe subscription found' }, { status: 400 });
    }

    // Get dunning settings
    const settings = await db.query.dunningSettings.findFirst({
      where: eq(dunningSettings.tenantId, ctx.tenantId),
    });

    const maxRetries = settings?.maxRetries || 3;

    // Get ALL dunning attempts for this tenant + subscription, regardless of
    // status. Attempts that transition pending -> failed/succeeded must still
    // count toward the retry cap and toward the monotonic attemptNumber,
    // otherwise maxRetries is never enforced and attemptNumber collides/resets.
    const allAttempts = await db.query.dunningAttempts.findMany({
      where: and(
        eq(dunningAttempts.tenantId, ctx.tenantId),
        eq(dunningAttempts.subscriptionId, subscriptionId),
      ),
    });

    if (allAttempts.length >= maxRetries) {
      return NextResponse.json({ 
        error: `Maximum retry attempts (${maxRetries}) reached. Contact support to override.` 
      }, { status: 400 });
    }

    // Create new dunning attempt. Derive the next attemptNumber from the max
    // existing attemptNumber (over ALL attempts) so numbers stay monotonic and
    // never collide with prior failed/succeeded attempts.
    const maxAttemptNumber = allAttempts.reduce(
      (max, a) => (a.attemptNumber > max ? a.attemptNumber : max),
      0,
    );
    const attemptNumber = maxAttemptNumber + 1;

    const [attempt] = await db.transaction(async (tx) => {
      const [a] = await tx.insert(dunningAttempts).values({
        tenantId: ctx.tenantId,
        subscriptionId: subscriptionId,
        attemptNumber: attemptNumber,
        status: 'pending',
        scheduledAt: new Date(),
        paymentAmount: '0', // Will be populated from Stripe invoice
        metadata: {
          created_by: ctx.userId,
          manual_retry: true,
        },
      }).returning();

      if (!a) {
        throw new Error('Failed to create dunning attempt');
      }

      // TODO: In a real implementation, this would trigger a background job
      // to retry the payment via Stripe. For now, we'll just record the attempt.
      
      // Record billing event
      await tx.insert(billingEvents).values({
        tenantId: ctx.tenantId,
        eventType: 'dunning.retry_initiated',
        amount: '0',
        currency: 'usd',
        metadata: {
          subscription_id: subscriptionId,
          attempt_id: a.id,
          attempt_number: attemptNumber,
          initiated_by: ctx.userId,
        },
      });

      return [a];
    });

    return NextResponse.json({
      data: {
        attemptId: attempt.id,
        attemptNumber: attemptNumber,
        status: 'pending',
        scheduledAt: attempt.scheduledAt,
        message: `Payment retry attempt ${attemptNumber} initiated`,
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
}

/**
 * GET /api/tenant/billing/dunning/retry
 * Get dunning attempts for a subscription.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const subscriptionId = searchParams.get('subscriptionId');

    if (!subscriptionId) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }

    const attempts = await db.query.dunningAttempts.findMany({
      where: and(
        eq(dunningAttempts.tenantId, ctx.tenantId),
        eq(dunningAttempts.subscriptionId, subscriptionId),
      ),
      orderBy: (dunningAttempts, { desc }) => [desc(dunningAttempts.attemptNumber)],
    });

    return NextResponse.json({ data: attempts });
  } catch (err: unknown) {
    return apiError(err);
  }
}
