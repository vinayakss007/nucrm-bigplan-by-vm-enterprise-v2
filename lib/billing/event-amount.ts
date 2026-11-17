/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3586 — the amount written to `billing_events` must match the Stripe Price
 * actually charged. `getPriceId(plan, 'year')` selects the YEARLY price, but the
 * upgrade route used to record `priceMonthly` unconditionally — a $1,990 annual
 * charge logged as $199. (Downgrades are always monthly by design and are
 * unaffected.) Kept as a pure leaf so the interval arithmetic is unit-testable.
 */

export interface PlanPrices {
  priceMonthly: string | number | null;
  priceYearly: string | number | null;
}

/**
 * The plan price for the interval Stripe was actually charged at.
 * Falls back to the monthly price only when a yearly price is not configured
 * at all (null/empty), never when it is legitimately '0'.
 */
export function billingEventAmount(plan: PlanPrices, interval: 'month' | 'year'): string {
  const chosen = interval === 'year'
    ? (plan.priceYearly == null || plan.priceYearly === '' ? plan.priceMonthly : plan.priceYearly)
    : plan.priceMonthly;
  const value = chosen ?? '0';
  return value === '' ? '0' : String(value);
}
