/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { verifySecret } from '@/lib/crypto';
import { logError } from '@/lib/errors-server';
import { acquireLock } from '@/lib/cache';
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
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Distributed dedup guard (#1422): skip when another scheduler
  // instance already fired this job within its interval.
  const lock = await acquireLock('cron:subscription-check', 3600);
  if (!lock.acquired) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'lock-held' });
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
        // #1106: downgrade touches tenants + subscriptions + billing events —
        // wrap all writes in one transaction so a partial failure can't leave
        // the tenant half-downgraded.
        await db.transaction(async (tx) => {
          // Downgrade tenant to free
          await tx
            .update(tenants)
            .set({
              planId: 'free',
              status: 'cancelled',
              updatedAt: new Date(),
            })
            .where(eq(tenants.id, sub.tenantId));

          // Clean subscription row
          await tx
            .update(subscriptions)
            .set({
              planId: 'free',
              stripeSubscriptionId: null,
              cancelAtPeriodEnd: false,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, sub.subscriptionId));

          // Audit trail
          await tx.insert(billingEvents).values({
            tenantId: sub.tenantId,
            eventType: 'subscription_downgraded',
            metadata: {
              reason: 'fallback_cron',
              previous_status: sub.stripeStatus,
              period_end: sub.currentPeriodEnd?.toISOString(),
              detected_at: new Date().toISOString(),
            },
          });
        });

        downgraded++;
 
 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
        void logError({ error: err, context: 'cron/subscription-check tenant', tenantId: sub.tenantId });
      }
    }

    console.log(`[subscription-check] Scanned ${staleSubscriptions.length}, downgraded ${downgraded}`);

    return NextResponse.json({
      ok: true,
      scanned: staleSubscriptions.length,
      downgraded,
      timestamp: new Date().toISOString(),
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'cron/subscription-check' });
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
