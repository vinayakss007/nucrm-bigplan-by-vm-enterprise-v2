/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 PR-5A — one discriminated Result, and a screen that refuses to let a
 * caller throw the failure away.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';

import { ok, fail, isOk, isFail, unwrapOr } from '@/lib/result';
import { resolveCheckoutPlan } from '@/lib/stripe-plan-resolution';
import { findResultFunctions, classifySource, run } from '../../scripts/check-result-consumed.mjs';

const ROOT = join(import.meta.dirname!, '..', '..');

const savedEnv = { ...process.env };
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('#3408 the Result contract', () => {
  it('is discriminated on ok and carries data or error, never both', () => {
    const good = ok({ planId: 'pro' });
    const bad = fail({ reason: 'no-price-id' as const, priceId: null });

    expect(good).toEqual({ ok: true, data: { planId: 'pro' } });
    expect(bad).toEqual({ ok: false, error: { reason: 'no-price-id', priceId: null } });
    expect(isOk(good)).toBe(true);
    expect(isFail(good)).toBe(false);
    expect(isFail(bad)).toBe(true);
    expect(unwrapOr(good, { planId: 'starter' })).toEqual({ planId: 'pro' });
    expect(unwrapOr(bad, { planId: 'starter' })).toEqual({ planId: 'starter' });
  });

  it('the migrated domain helper returns the same shape', async () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro';
    const mapped = await resolveCheckoutPlan({
      subscription: { items: { data: [{ price: { id: 'price_pro' } }] } },
    });
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.data).toMatchObject({ planId: 'pro', priceId: 'price_pro' });

    const unmapped = await resolveCheckoutPlan({
      subscription: { items: { data: [{ price: { id: 'price_unknown' } }] } },
    });
    expect(unmapped.ok).toBe(false);
    if (!unmapped.ok) expect(unmapped.error).toMatchObject({ reason: 'unmapped-price-id', priceId: 'price_unknown' });
  });
});

describe('#3408 the discarded-Result screen', () => {
  const fixture = `
import { ok, type Result } from '@/lib/result';
export async function findWidget(): Promise<Result<{ id: string }, string>> {
  return ok({ id: 'w1' });
}
export async function callers() {
  await findWidget();
  const bound = await findWidget();
  return await findWidget();
}
`;

  it('discovers Result-returning helpers and fires only on the discarded call', () => {
    expect(findResultFunctions(fixture)).toContain('findWidget');
    const { findings, checked } = classifySource(fixture, ['findWidget'], 'fixture.ts');
    expect(checked).toBe(3);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'unbound', name: 'findWidget', line: 7 });
  });

  it('accepts binding, returning, passing and branching on the result', () => {
    const consumed = `
export async function f(): Promise<Result<number, string>> { return ok(1); }
async function g() {
  const a = await f();
  const b = await Promise.resolve(await f());
  const c = [await f()];
  if ((await f()).ok) return 1;
}
`;
    const { findings, checked } = classifySource(consumed, ['f'], 'consumed.ts');
    expect(checked).toBe(4);
    expect(findings).toEqual([]);
  });

  it('the repo scan is currently clean', () => {
    const { helpers, findings } = run(ROOT);
    expect(helpers.length).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });
});
