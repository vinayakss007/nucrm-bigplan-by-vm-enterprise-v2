/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Stripe subscription period resolvers (#1915).
 *
 * On newer Stripe API versions the period fields moved from the subscription
 * root onto the subscription items. Prefer the root, fall back to the first
 * item, else 0 (caller decides how to handle unknown).
 */
import type { StripeSubscription } from './stripe';

function resolvePeriodField(
  sub: StripeSubscription,
  field: 'current_period_start' | 'current_period_end'
): number {
  const root = sub[field];
  if (typeof root === 'number' && root > 0) {
    return root;
  }
  const item = sub.items?.data?.[0] as { [k in typeof field]?: unknown } | undefined;
  const value = item?.[field];
  if (typeof value === 'number' && value > 0) {
    return value;
  }
  return 0;
}

export function getSubscriptionPeriodEnd(sub: StripeSubscription): number {
  return resolvePeriodField(sub, 'current_period_end');
}

export function getSubscriptionPeriodStart(sub: StripeSubscription): number {
  return resolvePeriodField(sub, 'current_period_start');
}
