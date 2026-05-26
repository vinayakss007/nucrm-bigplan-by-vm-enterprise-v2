/**
 * Daily fallback cron — catches up tenants whose Stripe subscription has
 * ended but whose webhook delivery failed.
 *
 * Stripe retries failed webhook deliveries for 3 days, then gives up. If
 * `customer.subscription.deleted` or a final `customer.subscription.updated`
 * never lands, the tenant stays on a paid `planId` past the period end and
 * `checkLimit()` keeps evaluating against paid-tier numbers. This cron
 * snaps those stragglers back to the free plan.
 *
 * Schedule: 0 5 * * *  (daily at 05:00 UTC, after the trial-check at 00:00)
 */
import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants, subscriptions, billingEvents } from '@/drizzle/schema';
import { eq, and, lt, isNotNull, inArray, ne, or, sql } from 'drizzle-orm';

// One-hour grace period after period_end so a still-arriving webhook wins.
const GRACE_MINUTES = 60;

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Pull every subscription that should already be over but is still
    // attached to a non-free plan on the tenants row. Two signals:
    //   1. Stripe says the subscription is in a terminal state.
    //   2. cancel_at_period_end was set and the period has fully elapsed.
    const cutoff = sql`now() - interval '${sql.raw(String(GRACE_MINUTES))} minutes'`;

    const stragglers = await db
      .select({
        tenantId: subscriptions.tenantId,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        status: subscriptions.status,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
        currentTenantPlan: tenants.planId,
      })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(
        and(
          isNotNull(subscriptions.currentPeriodEnd),
          lt(subscriptions.currentPeriodEnd, cutoff),
          or(
            inArray(subscriptions.status, ['canceled', 'incomplete_expired', 'unpaid']),
            eq(subscriptions.cancelAtPeriodEnd, true),
          ),
          ne(tenants.planId, 'free'),
        ),
      );

    let downgraded = 0;
    for (const row of stragglers) {
      try {
        await db
          .update(tenants)
          .set({ planId: 'free', status: 'cancelled', updatedAt: new Date() })
          .where(eq(tenants.id, row.tenantId));

        await db
          .update(subscriptions)
          .set({
            planId: 'free',
            status: 'canceled',
            stripeSubscriptionId: null,
            cancelAtPeriodEnd: false,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.tenantId, row.tenantId));

        await db.insert(billingEvents).values({
          tenantId: row.tenantId,
          eventType: 'subscription_check_downgrade',
          stripeSubscriptionId: row.stripeSubscriptionId,
          metadata: {
            previousPlan: row.currentTenantPlan,
            stripeStatus: row.status,
            cancelAtPeriodEnd: row.cancelAtPeriodEnd,
            currentPeriodEnd: row.currentPeriodEnd,
            reason: 'fallback_cron',
          },
        });

        downgraded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[subscription-check] failed to downgrade tenant', row.tenantId, msg);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: stragglers.length,
      downgraded,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[subscription-check]', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
