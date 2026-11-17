/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3586 — the billing ledger must record the price Stripe actually charged.
 * getPriceId(plan, 'year') selects the yearly Stripe Price, but the upgrade
 * route recorded `priceMonthly` unconditionally (enterprise: $199 instead of
 * $1,990). Downgrades are always monthly and must stay that way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { billingEventAmount } from '../../lib/billing/event-amount';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');
const UPGRADE = read('app/api/tenant/billing/subscription/upgrade/route.ts');
const DOWNGRADE = read('app/api/tenant/billing/subscription/downgrade/route.ts');

const ENTERPRISE = { priceMonthly: '199', priceYearly: '1990' };

describe('#3586 the billing event amount', () => {
  it('records the yearly price for a yearly charge', () => {
    expect(billingEventAmount(ENTERPRISE, 'year')).toBe('1990');
    expect(billingEventAmount({ priceMonthly: '29', priceYearly: '290' }, 'year')).toBe('290');
  });

  it('records the monthly price for a monthly charge', () => {
    expect(billingEventAmount(ENTERPRISE, 'month')).toBe('199');
  });

  it('falls back to monthly only when no yearly price is configured', () => {
    expect(billingEventAmount({ priceMonthly: '49', priceYearly: null }, 'year')).toBe('49');
    expect(billingEventAmount({ priceMonthly: '49', priceYearly: '' }, 'year')).toBe('49');
  });

  it('never records an empty or null amount', () => {
    expect(billingEventAmount({ priceMonthly: null, priceYearly: null }, 'year')).toBe('0');
    expect(billingEventAmount({ priceMonthly: '', priceYearly: '' }, 'month')).toBe('0');
  });

  it('accepts numeric prices from Drizzle rows', () => {
    expect(billingEventAmount({ priceMonthly: 199, priceYearly: 1990 }, 'year')).toBe('1990');
  });
});

describe('#3586 route wiring', () => {
  it('the upgrade route uses the interval-aware helper', () => {
    expect(UPGRADE).toContain('amount: billingEventAmount(newPlan, interval),');
    expect(UPGRADE).not.toContain("amount: String(newPlan.priceMonthly || '0')");
  });

  it('the downgrade stays monthly by design', () => {
    expect(DOWNGRADE).toMatch(/getPriceId\(planId, 'month'\);? \/\/ Downgrades are always monthly/);
    expect(DOWNGRADE).toContain("amount: String(newPlan.priceMonthly || '0')");
  });
});
