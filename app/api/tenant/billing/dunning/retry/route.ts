import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { subscriptions, dunningAttempts, dunningSettings, billingEvents } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody } from '@/lib/api/validate';
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

    const raw = await request.json();
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

    // Get pending dunning attempts
    const pendingAttempts = await db.query.dunningAttempts.findMany({
      where: and(
        eq(dunningAttempts.subscriptionId, subscriptionId),
        eq(dunningAttempts.status, 'pending'),
      ),
    });

    if (pendingAttempts.length >= maxRetries) {
      return NextResponse.json({ 
        error: `Maximum retry attempts (${maxRetries}) reached. Contact support to override.` 
      }, { status: 400 });
    }

    // Create new dunning attempt
    const attemptNumber = pendingAttempts.length + 1;
    const [attempt] = await db.insert(dunningAttempts).values({
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

    // TODO: In a real implementation, this would trigger a background job
    // to retry the payment via Stripe. For now, we'll just record the attempt.
    
    // Record billing event
    await db.insert(billingEvents).values({
      tenantId: ctx.tenantId,
      eventType: 'dunning.retry_initiated',
      amount: '0',
      currency: 'usd',
      metadata: {
        subscription_id: subscriptionId,
        attempt_id: attempt.id,
        attempt_number: attemptNumber,
        initiated_by: ctx.userId,
      },
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
      where: eq(dunningAttempts.subscriptionId, subscriptionId),
      orderBy: (dunningAttempts, { desc }) => [desc(dunningAttempts.attemptNumber)],
    });

    return NextResponse.json({ data: attempts });
  } catch (err: unknown) {
    return apiError(err);
  }
}
