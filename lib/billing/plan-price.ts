/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * The amount a plan change charges, in the plan's own currency units.
 *
 * #3586 — Stripe picks the price by interval (`getPriceId(planId, interval)`
 * maps `year` to `STRIPE_PRICE_<PLAN>_YEARLY`), but the ledger was written from
 * `priceMonthly` unconditionally: a $1,990 annual charge was recorded as $199.
 * The plan row already carries `price_yearly`; this is the single place that
 * chooses between the two so the ledger matches what the customer was charged.
 *
 * Absent means null/empty/zero — the column defaults to `'0'`, so a plan with
 * no separately priced year falls back to the monthly price rather than
 * recording a free upgrade.
 */

export type BillingInterval = 'month' | 'year';

export interface PlanPrice {
  priceMonthly?: string | number | null;
  priceYearly?: string | number | null;
}

function isPriced(value: string | number | null | undefined): boolean {
  if (value == null) return false;
  const text = String(value).trim();
  return text !== '' && Number(text) > 0;
}

export function billingEventAmount(plan: PlanPrice, interval: BillingInterval): string {
  const yearly = interval === 'year' && isPriced(plan.priceYearly)
    ? plan.priceYearly
    : plan.priceMonthly;
  return isPriced(yearly) ? String(yearly) : '0';
}
