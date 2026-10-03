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
import { updateSubscription, getPriceId, isStripeConfigured, getSubscriptionPeriodStart, getSubscriptionPeriodEnd } from '@/lib/stripe';
import { deriveUpgradeIdempotencyKey } from '@/lib/billing-idempotency';
import { logError } from '@/lib/errors-server';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

const upgradeSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  interval: z.enum(['month', 'year']).optional().default('month'),
});

/**
 * Append a billing_events row that must NEVER fail the request: these marker
 * rows are forensics (#2228), and a dead DB would also take down the write
 * half of the flow anyway — silently swallowing the marker insert error is
 * the correct trade here, the Stripe idempotency key is the real guard.
 */
async function recordUpgradeMarker(
  tenantId: string,
  stripeSubscriptionId: string,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(billingEvents).values({
      tenantId,
      eventType,
      currency: 'usd',
      stripeSubscriptionId,
      metadata,
    });
  } catch (err) {
    void logError({ error: err, context: `billing upgrade marker (${eventType})`, tenantId, level: 'warning' });
  }
}

/**
 * POST /api/tenant/billing/subscription/upgrade
 * Upgrade to a higher plan with proration.
 * 
 * Body: { planId: string, interval?: 'month' | 'year' }
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

    if (currentPlan && (Number(newPlan.priceMonthly) || 0) <= (Number(currentPlan.priceMonthly) || 0)) {
      return NextResponse.json({ error: 'This is not an upgrade. Use downgrade endpoint instead.' }, { status: 400 });
    }

    // Get Stripe price ID
    const priceId = getPriceId(planId, interval);
    if (!priceId) {
      return NextResponse.json({ error: `Price not configured for ${planId}/${interval}. Contact support.` }, { status: 500 });
    }

    // ── #2228: Stripe-first double-charge guard ─────────────────────────
    // Old flow: updateSubscription() re-priced in Stripe, THEN a local tx
    // wrote subscriptions + billing_events. If the tx threw (pool timeout,
    // constraint) Stripe was on the new plan while the DB stayed on the old
    // one — and a client retry re-called updateSubscription with NO
    // idempotency key, double-applying proration.
    //
    // New flow:
    //   1. derive a deterministic Idempotency-Key from the INTENT
    //      (tenant, stripe sub, from-plan → to-plan, interval). Every retry
    //      of the same intent reproduces the same key, so Stripe replays the
    //      first response instead of charging a second time; a genuinely
    //      different intent (plan changed in between) gets a fresh key.
    //   2. persist the `subscription.upgrade_attempted` marker BEFORE the
    //      Stripe call, so an event log always exists for a charge that may
    //      have happened even if this process dies mid-flight.
    //   3. Stripe failure → `subscription.upgrade_failed` marker, rethrow
    //      (nothing was charged; a retry legitimately re-attempts).
    //   4. DB tx failure AFTER Stripe success → `subscription.upgrade_desynced`
    //      marker carrying the Stripe period timestamps; the retry now replays
    //      the idempotent Stripe response and re-runs the tx (self-heal), and
    //      the customer.subscription.updated webhook additionally reconciles
    //      the subscriptions row from Stripe source-of-truth (#2228).
    const idempotencyKey = deriveUpgradeIdempotencyKey({
      tenantId: ctx.tenantId,
      stripeSubscriptionId: currentSub.stripeSubscriptionId,
      fromPlanId: currentSub.planId,
      toPlanId: planId,
      interval,
    });

    await recordUpgradeMarker(ctx.tenantId, currentSub.stripeSubscriptionId, 'subscription.upgrade_attempted', {
      idempotency_key: idempotencyKey,
      previous_plan_id: currentSub.planId || 'none',
      new_plan_id: planId,
      interval,
      upgraded_by: ctx.userId,
    });

    // Update subscription in Stripe (proration happens automatically)
    let stripeSub: Awaited<ReturnType<typeof updateSubscription>>;
    try {
      stripeSub = await updateSubscription(currentSub.stripeSubscriptionId, {
        priceId,
        metadata: {
          tenant_id: ctx.tenantId,
          plan_id: planId,
          interval,
          upgraded_by: ctx.userId,
        },
        idempotencyKey,
      });
    } catch (err) {
      await recordUpgradeMarker(ctx.tenantId, currentSub.stripeSubscriptionId, 'subscription.upgrade_failed', {
        idempotency_key: idempotencyKey,
        new_plan_id: planId,
        interval,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    // #1915: resolve period timestamps via the item-fallback helpers; Stripe
    // API 2025+ omits the root fields, which previously persisted Invalid Date.
    const periodStart = getSubscriptionPeriodStart(stripeSub);
    const periodEnd = getSubscriptionPeriodEnd(stripeSub);

    // Update subscription in database
    try {
      await db.transaction(async (tx) => {
        await tx.update(subscriptions).set({
          planId: planId,
          status: 'active',
          currentPeriodStart: periodStart ? new Date(periodStart * 1000) : currentSub.currentPeriodStart,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : currentSub.currentPeriodEnd,
          cancelAtPeriodEnd: false,
          metadata: {
            ...(currentSub.metadata as Record<string, unknown> || {}),
            upgraded_at: new Date().toISOString(),
            upgraded_by: ctx.userId,
            previous_plan_id: currentSub.planId,
          },
        }).where(eq(subscriptions.id, currentSub.id));

        // Record billing event
        await tx.insert(billingEvents).values({
          tenantId: ctx.tenantId,
          eventType: 'subscription.upgraded',
          amount: String(newPlan.priceMonthly || '0'),
          currency: 'usd',
          stripeSubscriptionId: currentSub.stripeSubscriptionId,
          metadata: {
            previous_plan_id: currentSub.planId || 'none',
            new_plan_id: planId,
            interval,
            upgraded_by: ctx.userId,
            idempotency_key: idempotencyKey,
          },
        });
      });
    } catch (err) {
      // Stripe is already on the new plan — the local write failed. Mark the
      // desync (with the Stripe truth attached) and rethrow. A client retry
      // hits the SAME Idempotency-Key (currentSub.planId is unchanged in the
      // DB, so the derived intent is identical), Stripe replays, and the tx
      // re-runs — no second charge, and the drift heals. The
      // customer.subscription.updated webhook reconciliation is the backstop
      // even if no retry ever comes (#2228).
      await recordUpgradeMarker(ctx.tenantId, currentSub.stripeSubscriptionId, 'subscription.upgrade_desynced', {
        idempotency_key: idempotencyKey,
        previous_plan_id: currentSub.planId || 'none',
        new_plan_id: planId,
        interval,
        stripe_period_start: periodStart ?? null,
        stripe_period_end: periodEnd ?? null,
        stripe_status: stripeSub.status ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    return NextResponse.json({
      data: {
        subscriptionId: currentSub.id,
        planId: planId,
        planName: newPlan.name,
        status: 'active',
        currentPeriodEnd: periodEnd || null,
        message: `Successfully upgraded to ${newPlan.name}`,
      },
    });
  } catch (err: unknown) {
    return apiError(err);
  }
});
