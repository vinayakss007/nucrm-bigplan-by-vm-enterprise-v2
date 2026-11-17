/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3586 — the billing ledger must record the price Stripe actually charges.
 *
 * `plans` has both `price_monthly` and `price_yearly`, and Stripe's Price is
 * chosen by interval. Both plan-change routes wrote `priceMonthly`
 * unconditionally, so an annual $1,990 upgrade was recorded as $199.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { billingEventAmount } from '@/lib/billing/plan-price';

const ROOT = join(import.meta.dirname!, '..', '..');
const enterprise = { priceMonthly: '199', priceYearly: '1990' };

describe('billingEventAmount', () => {
  it('uses the yearly price for an annual interval', () => {
    expect(billingEventAmount(enterprise, 'year')).toBe('1990');
  });

  it('uses the monthly price for a monthly interval', () => {
    expect(billingEventAmount(enterprise, 'month')).toBe('199');
  });

  it('falls back to monthly when no distinct yearly price exists', () => {
    expect(billingEventAmount({ priceMonthly: '49', priceYearly: null }, 'year')).toBe('49');
    expect(billingEventAmount({ priceMonthly: '49', priceYearly: '0' }, 'year')).toBe('49');
  });

  it('records 0 when neither price is usable, as a string', () => {
    expect(billingEventAmount({}, 'year')).toBe('0');
    expect(billingEventAmount({ priceMonthly: undefined, priceYearly: '' }, 'month')).toBe('0');
  });

  it('accepts numeric prices the way the seed supplies them', () => {
    expect(billingEventAmount({ priceMonthly: 199, priceYearly: 1990 }, 'year')).toBe('1990');
  });
});

describe('plan-change routes call the helper', () => {
  const source = (p: string) => readFileSync(join(ROOT, p), 'utf8');

  it('upgrade passes the requested interval', () => {
    const text = source('app/api/tenant/billing/subscription/upgrade/route.ts');
    expect(text).toContain('amount: billingEventAmount(newPlan, interval)');
    expect(text).not.toContain("String(newPlan.priceMonthly || '0')");
  });

  it('downgrade passes month explicitly, matching its monthly-only price lookup', () => {
    const text = source('app/api/tenant/billing/subscription/downgrade/route.ts');
    expect(text).toContain("amount: billingEventAmount(newPlan, 'month')");
    expect(text).not.toContain("String(newPlan.priceMonthly || '0')");
  });
});
