/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3583 — module add-on checkout used a fabricated Stripe Price id
 * (`price_module_${module_id}`) that Stripe rejects on every call, while the
 * price computed from the module manifest was thrown away. The checkout now
 * uses Stripe's inline `price_data` with that amount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCheckoutLineItem } from '../../lib/stripe';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');
const ROUTE = read('app/api/tenant/billing/modules/route.ts');

describe('#3583 the checkout line item', () => {
  it('uses inline price_data with the manifest-derived amount', () => {
    const item = buildCheckoutLineItem({
      tenantId: 't1',
      mode: 'subscription',
      priceData: {
        currency: 'usd',
        unitAmount: 2900, // automation-pro: $29/month on starter
        productName: 'Automation Pro add-on',
        recurringInterval: 'month',
      },
    });
    expect(item['price']).toBeUndefined();
    expect(item['price_data']).toEqual({
      currency: 'usd',
      unit_amount: 2900,
      product_data: { name: 'Automation Pro add-on' },
      recurring: { interval: 'month' },
    });
    expect(item['quantity']).toBe(1);
  });

  it('keeps the legacy price-id path for plan checkouts', () => {
    const item = buildCheckoutLineItem({
      tenantId: 't1',
      mode: 'subscription',
      priceId: 'price_pro_monthly',
    });
    expect(item['price']).toBe('price_pro_monthly');
    expect(item['price_data']).toBeUndefined();
  });

  it('never mixes price and price_data — Stripe rejects both together', () => {
    const item = buildCheckoutLineItem({
      tenantId: 't1',
      mode: 'subscription',
      quantity: 2,
      priceData: { currency: 'usd', unitAmount: 1900, productName: 'WhatsApp add-on' },
    });
    expect(Object.keys(item).filter((k) => k === 'price' || k === 'price_data')).toEqual(['price_data']);
    expect(item['quantity']).toBe(2);
    expect((item['price_data'] as Record<string, unknown>)['recurring']).toBeUndefined();
  });
});

describe('#3583 the module checkout route', () => {
  it('no longer sends a fabricated price id, and forwards the computed amount', () => {
    expect(ROUTE).not.toContain('price_module_');
    expect(ROUTE).toMatch(/priceData:\s*\{[\s\S]*?unitAmount: priceInCents/);
    expect(ROUTE).toContain("recurringInterval: 'month'");
  });
});
