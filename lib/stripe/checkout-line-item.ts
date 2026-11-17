/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Checkout line-item contract (#3583). Split out of `lib/stripe.ts` so the
 * grandfathered 500-line ratchet there keeps shrinking instead of growing.
 *
 * Stripe accepts `price` OR `price_data` on a line item, never both. Plan
 * checkouts have a pre-created Price; module add-ons do not, so they use an
 * inline price built from the manifest amount.
 */

/** An inline Stripe Price for catalog items with no pre-created Price. */
export interface CheckoutPriceData {
  /** Three-letter ISO currency code, lowercase — Stripe's requirement. */
  currency: string;
  /** Amount in the smallest currency unit (cents for usd). */
  unitAmount: number;
  productName: string;
  recurringInterval?: 'month' | 'year';
}

export type CheckoutParams = {
  tenantId: string;
  customerId?: string;
  customerEmail?: string;
  mode: 'subscription' | 'payment';
  successUrl?: string;
  cancelUrl?: string;
  trialDays?: number;
  metadata?: Record<string, string>;
  quantity?: number;
} & (
  | { priceId: string; priceData?: never }
  | { priceData: CheckoutPriceData; priceId?: never }
);

/**
 * Build the single line item for a checkout session. Pure and exported so the
 * price/price-data contract is unit-testable without a Stripe round trip.
 */
export function buildCheckoutLineItem(params: CheckoutParams): Record<string, unknown> {
  const lineItem: Record<string, unknown> = { quantity: params.quantity || 1 };
  if (params.priceData) {
    lineItem['price_data'] = {
      currency: params.priceData.currency,
      unit_amount: params.priceData.unitAmount,
      product_data: { name: params.priceData.productName },
      ...(params.priceData.recurringInterval
        ? { recurring: { interval: params.priceData.recurringInterval } }
        : {}),
    };
  } else {
    lineItem['price'] = params.priceId;
  }
  return lineItem;
}
