/**
 * lib/stripe — Idempotency-Key header plumbing (#2228).
 *
 * The upgrade route derives a deterministic key from the billing intent
 * (tests/unit/billing/upgrade-idempotency.test.ts); THIS test proves the key
 * actually reaches Stripe as the `Idempotency-Key` header on the mutating
 * POST — without it, no amount of deterministic derivation prevents the
 * double proration, because Stripe only dedupes on that header.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { updateSubscription, cancelSubscription, resumeSubscription } from '@/lib/stripe';

const SUB_RESPONSE = {
  id: 'sub_1',
  object: 'subscription',
  status: 'active',
  items: { data: [{ id: 'si_1', price: { id: 'price_new' } }] },
};

let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  fetchCalls = [];
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => SUB_RESPONSE,
    } as unknown as Response;
  }));
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  vi.unstubAllGlobals();
});

function headersOf(call: { init: RequestInit }): Record<string, string> {
  return (call.init.headers ?? {}) as Record<string, string>;
}

describe('lib/stripe Idempotency-Key header (#2228)', () => {
  it('updateSubscription forwards params.idempotencyKey on the mutating POST only', async () => {
    await updateSubscription('sub_1', { priceId: 'price_new', idempotencyKey: 'KEY-ABC' });

    // call 0 = the GET used to resolve the item id (no key on reads),
    // call 1 = the POST that mutates billing state (key required)
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]!.init.method).toBe('GET');
    expect(headersOf(fetchCalls[0]!)['Idempotency-Key']).toBeUndefined();
    expect(fetchCalls[1]!.init.method).toBe('POST');
    expect(headersOf(fetchCalls[1]!)['Idempotency-Key']).toBe('KEY-ABC');
  });

  it('omits the header entirely when no key is given (unchanged legacy behavior)', async () => {
    await updateSubscription('sub_1', { priceId: 'price_new' });
    const post = fetchCalls.find((c) => c.init.method === 'POST')!;
    expect(headersOf(post)['Idempotency-Key']).toBeUndefined();
  });

  it('cancelSubscription (both shapes) and resumeSubscription forward the key', async () => {
    await cancelSubscription('sub_1', true, 'KEY-CANCEL-PPE');
    await cancelSubscription('sub_1', false, 'KEY-CANCEL-NOW');
    await resumeSubscription('sub_1', 'KEY-RESUME');

    const mutators = fetchCalls.filter((c) => c.init.method === 'POST' || c.init.method === 'DELETE');
    expect(mutators).toHaveLength(3);
    expect(headersOf(mutators[0]!)['Idempotency-Key']).toBe('KEY-CANCEL-PPE');
    expect(headersOf(mutators[1]!)['Idempotency-Key']).toBe('KEY-CANCEL-NOW');
    expect(mutators[1]!.init.method).toBe('DELETE');
    expect(headersOf(mutators[2]!)['Idempotency-Key']).toBe('KEY-RESUME');
  });
});
