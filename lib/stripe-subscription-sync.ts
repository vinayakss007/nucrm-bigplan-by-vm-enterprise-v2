/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { db } from '@/drizzle/db';
import { subscriptions } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

/** The subset of a Stripe subscription object the local row mirrors. */
export interface SyncableStripeSubscription {
  id?: string | null;
  cancel_at_period_end?: boolean;
  current_period_start?: number | null;
  current_period_end?: number | null;
}

/**
 * #2228 — bring the local `subscriptions` row in line with the Stripe event.
 * Matched on stripe_subscription_id (not tenant) because that is the exact
 * entity Stripe just described. Fields absent from the payload are left
 * untouched; the update is value-idempotent, so a webhook retry after a
 * partial failure is harmless.
 */
export async function syncSubscriptionRow(
  subscription: SyncableStripeSubscription,
  planId: string | null,
  nuCrmStatus: string,
): Promise<void> {
  if (!subscription.id) return;

  // subscriptions.status vocabulary in this app is 'canceled' (one L) — the
  // tenants mapping in the webhook uses 'cancelled'; normalize before persisting.
  const subStatus = nuCrmStatus === 'cancelled' ? 'canceled' : nuCrmStatus;

  const updates: {
    status: string;
    updatedAt: Date;
    planId?: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
  } = {
    status: subStatus,
    updatedAt: new Date(),
  };
  if (planId) updates.planId = planId;
  if (typeof subscription.cancel_at_period_end === 'boolean') {
    updates.cancelAtPeriodEnd = subscription.cancel_at_period_end;
  }
  // #1915: API 2025+ may omit the root period fields; only write what the
  // payload actually carries.
  if (typeof subscription.current_period_start === 'number') {
    updates.currentPeriodStart = new Date(subscription.current_period_start * 1000);
  }
  if (typeof subscription.current_period_end === 'number') {
    updates.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
  }

  await db.update(subscriptions)
    .set(updates)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
}

/** #2228 — subscription.deleted must retire the row, not just the tenant. */
export async function markSubscriptionCanceled(subscriptionId?: string | null): Promise<void> {
  if (!subscriptionId) return;
  await db.update(subscriptions)
    .set({
      status: 'canceled',
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
}
