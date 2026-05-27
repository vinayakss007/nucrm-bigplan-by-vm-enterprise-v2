import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { tenants, subscriptions, billingEvents } from '@/drizzle/schema';
import { eq, and, lt, ne, or, sql } from 'drizzle-orm';

/**
 * POST /api/cron/subscription-check
 *
 * Fallback cron for missed Stripe cancellation webhooks.
 * Stripe retries failed webhooks for ~3 days then gives up.
 * If `customer.subscription.deleted` never arrives, the tenant
 * stays on a paid plan past current_period_end forever.
 *
 * This cron catches those stragglers:
 * - Selects subscriptions where current_period_end is > 1 hour past
 * - AND Stripe status is terminal (canceled/incomplete_expired/unpaid)
 *   OR cancel_at_period_end was set
 * - AND the tenant is still on a non-free plan
 *
 * For each match: downgrade to free, null out subscription IDs,
 * write a billingEvent with reason='fallback_cron'.
 *
 * Schedule: daily at 05:00 UTC (see vercel.json / crontab)
 */
export async function POST(request: Request) {
  // Authenticate via cron secret
  const cronSecret = request.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Find subscriptions that should have been downgraded
    const staleSubscriptions = await db
      .select({
        subscriptionId: subscriptions.id,
        tenantId: subscriptions.tenantId,
        stripeStatus: subscriptions.status,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(
        and(
          // Period has ended (with 1-hour grace for late webhooks)
          lt(subscriptions.currentPeriodEnd, oneHourAgo),
          // Tenant is still on a paid plan
          ne(tenants.planId, 'free'),
          // Stripe says it's terminal OR cancel was requested
          or(
            sql`${subscriptions.status} IN ('canceled', 'incomplete_expired', 'unpaid')`,
            eq(subscriptions.cancelAtPeriodEnd, true)
          )
        )
      );

    let downgraded = 0;

    for (const sub of staleSubscriptions) {
      try {
        // Downgrade tenant to free
        await db
          .update(tenants)
          .set({
            planId: 'free',
            status: 'cancelled',
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, sub.tenantId));

        // Clean subscription row
        await db
          .update(subscriptions)
          .set({
            planId: 'free',
            stripeSubscriptionId: null,
            cancelAtPeriodEnd: false,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.subscriptionId));

        // Audit trail
        await db.insert(billingEvents).values({
          tenantId: sub.tenantId,
          eventType: 'subscription_downgraded',
          metadata: {
            reason: 'fallback_cron',
            previous_status: sub.stripeStatus,
            period_end: sub.currentPeriodEnd?.toISOString(),
            detected_at: new Date().toISOString(),
          },
        });

        downgraded++;
      } catch (err: any) {
        console.error(`[subscription-check] Failed to downgrade tenant ${sub.tenantId}:`, err.message);
      }
    }

    console.log(`[subscription-check] Scanned ${staleSubscriptions.length}, downgraded ${downgraded}`);

    return NextResponse.json({
      ok: true,
      scanned: staleSubscriptions.length,
      downgraded,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[subscription-check] Cron failed:', err.message);
    return NextResponse.json(
      { error: 'Internal error', message: err.message },
      { status: 500 }
    );
  }
}
