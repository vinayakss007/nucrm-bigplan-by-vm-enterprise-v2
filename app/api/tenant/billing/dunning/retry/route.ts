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
import { eq, and, sql, ne } from 'drizzle-orm';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { isStripeConfigured } from '@/lib/stripe';
import { withApiRoute } from '@/lib/api/with-api-route';

const retrySchema = z.object({
  subscriptionId: z.string().uuid('Invalid subscription ID'),
});

/** Thrown inside the retry transaction when the dunning retry cap is hit. */
class DunningCapReached extends Error {
  constructor(public readonly maxRetries: number) {
    super(`Maximum retry attempts (${maxRetries}) reached`);
    this.name = 'DunningCapReached';
  }
}

/**
 * POST /api/tenant/billing/dunning/retry
 * Manually retry a failed payment for a subscription.
 * 
 * Body: { subscriptionId: string }
 */
export const POST = withApiRoute(async (request: NextRequest) => {
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

    // #1464: The retry cap and the next attemptNumber must be derived from ALL
    // attempts in the current dunning cycle, not just those still 'pending'.
    // The old code counted only status='pending'; once earlier attempts
    // transitioned to 'failed', they stopped counting, so the cap was never
    // enforced and attemptNumber reset to 1/2/3... producing collisions.
    // A 'succeeded' attempt closes the cycle, so it (and everything before it)
    // is excluded from the cap while still being counted for attemptNumber.
    // Do the count + number allocation inside a transaction that locks the
    // subscription row so two concurrent retries cannot allocate the same slot.
    const [attempt, allocatedNumber] = await db.transaction(async (tx) => {
      // Serialize retries for this subscription.
      await tx.execute(sql`SELECT id FROM subscriptions WHERE id = ${subscriptionId} FOR UPDATE`);

      // Count active (non-succeeded) attempts toward the retry cap.
      const [capRow] = await tx.select({ c: sql<number>`count(*)::int` })
        .from(dunningAttempts)
        .where(and(
          eq(dunningAttempts.tenantId, ctx.tenantId),
          eq(dunningAttempts.subscriptionId, subscriptionId),
          ne(dunningAttempts.status, 'succeeded'),
        ));
      const activeAttempts = capRow?.c ?? 0;

      if (activeAttempts >= maxRetries) {
        throw new DunningCapReached(maxRetries);
      }

      // Next attemptNumber = MAX(existing) + 1 across ALL attempts (monotonic,
      // never collides even after attempts change status).
      const [maxRow] = await tx.select({
        maxNum: sql<number>`COALESCE(MAX(${dunningAttempts.attemptNumber}), 0)::int`,
      })
        .from(dunningAttempts)
        .where(and(
          eq(dunningAttempts.tenantId, ctx.tenantId),
          eq(dunningAttempts.subscriptionId, subscriptionId),
        ));
      const nextNumber = (maxRow?.maxNum ?? 0) + 1;

      const [a] = await tx.insert(dunningAttempts).values({
        tenantId: ctx.tenantId,
        subscriptionId: subscriptionId,
        attemptNumber: nextNumber,
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
      const attemptNumber = nextNumber;

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

      return [a, attemptNumber] as const;
    });

    return NextResponse.json({
      data: {
        attemptId: attempt.id,
        attemptNumber: allocatedNumber,
        status: 'pending',
        scheduledAt: attempt.scheduledAt,
        message: `Payment retry attempt ${allocatedNumber} initiated`,
      },
    });
  } catch (err: unknown) {
    if (err instanceof DunningCapReached) {
      return NextResponse.json({
        error: `Maximum retry attempts (${err.maxRetries}) reached. Contact support to override.`,
      }, { status: 400 });
    }
    return apiError(err);
  }
});

/**
 * GET /api/tenant/billing/dunning/retry
 * Get dunning attempts for a subscription.
 */
export const GET = withApiRoute(async (request: NextRequest) => {
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
});
