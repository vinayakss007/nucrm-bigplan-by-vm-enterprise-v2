/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Regression tests for #658 BUG-12: editing a tax rate always failed because
 * the API returns `rate` as a string (DB text/decimal), and the create/update
 * Zod schemas used `z.number()`, which rejects the string round-trip. The fix
 * coerces `rate` to a number so both a number and a numeric string are accepted.
 */
import { describe, it, expect, vi } from 'vitest';

// The route module imports DB/auth/rate-limit at the top level. Stub them so we
// can import the exported Zod schemas without opening a DB pool or auth stack.
vi.mock('@/drizzle/db', () => ({ db: {} }));
vi.mock('@/drizzle/schema/financial', () => ({ taxRates: {} }));
vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/modules/gate', () => ({ requireModule: vi.fn() }));
vi.mock('@/lib/api/concurrency', () => ({ concurrencyGuard: vi.fn() }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn() }));
vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (h: unknown) => h }));

import { createTaxRateSchema, updateTaxRateSchema } from '@/app/api/tenant/tax/route';

describe('#658 BUG-12 — tax rate schemas accept the string round-trip', () => {
  it('create: accepts a numeric string rate and coerces it to a number', () => {
    const parsed = createTaxRateSchema.parse({ name: 'GST', rate: '10' });
    expect(parsed.rate).toBe(10);
    expect(typeof parsed.rate).toBe('number');
  });

  it('create: still accepts a plain number rate', () => {
    const parsed = createTaxRateSchema.parse({ name: 'GST', rate: 7.5 });
    expect(parsed.rate).toBe(7.5);
  });

  it('update: accepts the numeric string returned by the API on edit', () => {
    // This is the exact payload that used to 400: rate comes back as "10".
    const parsed = updateTaxRateSchema.parse({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'GST',
      rate: '10',
    });
    expect(parsed.rate).toBe(10);
  });

  it('update: rate remains optional (omitting it is valid)', () => {
    const parsed = updateTaxRateSchema.parse({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Renamed only',
    });
    expect(parsed.rate).toBeUndefined();
  });

  it('rejects a non-numeric string (coercion must not mask bad input)', () => {
    expect(() => createTaxRateSchema.parse({ name: 'Bad', rate: 'abc' })).toThrow();
  });

  it('rejects a negative rate', () => {
    expect(() => createTaxRateSchema.parse({ name: 'Neg', rate: '-1' })).toThrow();
  });
});
