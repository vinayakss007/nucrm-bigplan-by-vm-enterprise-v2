/**
 * #2303 — Stripe plan resolution must FAIL CLOSED.
 *
 * The checkout.session.completed handler used to fall through to an amount
 * heuristic (`<=2900 -> starter`, `<=7900 -> pro`, else enterprise) and then
 * coerce a null plan to `'starter'`. On current Stripe API versions the
 * webhook payload carries `subscription` as a plain string id and does NOT
 * expand `line_items`, so the heuristic was the primary path and any pricing
 * change (INR localization, annual discount, promo, tax-inclusive totals)
 * silently granted the wrong tier.
 *
 * These tests drive the exported POST handler and prove:
 *   (1) exact price-id matches activate the correct plan (all three tiers);
 *   (2) an unknown/unmapped price id does NOT activate — the tenant is left in
 *       the non-entitled 'past_due' state with no planId written, the failure
 *       is logged and admins are alerted, and the webhook still ACKs 200;
 *   (3) the old heuristic boundary amounts (2900 / 7900 / above) now resolve
 *       conservatively instead of granting starter/pro/enterprise;
 *   (4) the realistic current-API shape (subscription is a string id, no
 *       line_items) is repaired by RETRIEVING the session from Stripe, and a
 *       failed/empty retrieval still fails closed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock DB harness (mirrors stripe-webhook-subscription-tenant.test.ts) ─────
const m = vi.hoisted(() => {
  const tenantTable = {
    id: 'tenants.id',
    stripeCustomerId: 'tenants.stripe_customer_id',
    status: 'tenants.status',
  };
  const webhookEventsTable = {
    id: 'webhookEvents.id',
    provider: 'webhookEvents.provider',
    eventId: 'webhookEvents.event_id',
    status: 'webhookEvents.status',
    createdAt: 'webhookEvents.created_at',
    processedAt: 'webhookEvents.processed_at',
  };
  const updateSet = vi.fn();
  const whereAfterUpdate = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    insert: vi.fn(() => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => [{ id: 'webhook-event-1' }] }),
      }),
    })),
    delete: vi.fn(() => ({ where: async () => ({ rowCount: 1 }) })),
    update: vi.fn((table: unknown) => ({
      set: (values: unknown) => ({
        where: (pred: unknown) => {
          if (table === tenantTable) {
            updateSet(values);
            whereAfterUpdate(pred);
          }
          return Promise.resolve({ rowCount: 1 });
        },
      }),
    })),
    query: {
      tenants: {
        findFirst: vi.fn(async () => null),
      },
    },
  };
  return { db, tenantTable, webhookEventsTable, updateSet, whereAfterUpdate };
});

const getCheckoutSession = vi.fn();

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  tenants: m.tenantTable,
  webhookEvents: m.webhookEventsTable,
}));
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...await importOriginal<typeof import('drizzle-orm')>(),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
}));
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  verifyWebhookSignature: async (body: string) => JSON.parse(body),
  StripeError: class StripeError extends Error {},
  getCheckoutSession: (...args: unknown[]) => getCheckoutSession(...args),
}));
vi.mock('@/lib/cache/index', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, value: 'lock-val' })),
  releaseLock: vi.fn(async () => undefined),
}));
vi.mock('@/lib/api-error', () => ({
  apiError: (_e: unknown, msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));
const sendAdminTelegram = vi.fn(async () => undefined);
vi.mock('@/lib/telegram-admin', () => ({
  sendAdminTelegram: (...args: unknown[]) => sendAdminTelegram(...args),
}));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
const logError = vi.fn();
vi.mock('@/lib/errors-server', () => ({ logError: (...args: unknown[]) => logError(...args) }));

import { POST } from '@/app/api/webhooks/stripe/route';
import { planFromPriceId } from '@/lib/stripe-plan-resolution';

const TENANT = 'tenant-checkout-1';
const SESSION_ID = 'cs_test_failclosed_1';

const PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER_MONTHLY: 'price_starter_monthly',
  STRIPE_PRICE_STARTER_YEARLY: 'price_starter_yearly',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_monthly',
  STRIPE_PRICE_PRO_YEARLY: 'price_pro_yearly',
  STRIPE_PRICE_ENTERPRISE_MONTHLY: 'price_enterprise_monthly',
  STRIPE_PRICE_ENTERPRISE_YEARLY: 'price_enterprise_yearly',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRequest(event: any): any {
  const body = JSON.stringify(event);
  return {
    headers: { get: (h: string) => (h === 'stripe-signature' ? 't=1,v1=sig' : null) },
    text: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkoutEvent(object: Record<string, any>) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: SESSION_ID,
        metadata: { tenant_id: TENANT },
        customer: 'cus_test_1',
        ...object,
      },
    },
  };
}

function lastTenantUpdate(): Record<string, unknown> | undefined {
  return m.updateSet.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(PRICE_ENV)) process.env[k] = v;
});

afterEach(() => {
  for (const k of Object.keys(PRICE_ENV)) delete process.env[k];
});

describe('#2303 exact price-id match activates the correct plan', () => {
  it.each([
    ['price_starter_monthly', 'starter'],
    ['price_starter_yearly', 'starter'],
    ['price_pro_monthly', 'pro'],
    ['price_pro_yearly', 'pro'],
    ['price_enterprise_monthly', 'enterprise'],
    ['price_enterprise_yearly', 'enterprise'],
  ])('line_items price %s -> plan %s, status active', async (priceId, plan) => {
    const res = await POST(makeRequest(checkoutEvent({
      subscription: 'sub_test_1', // realistic: plain string id
      line_items: { data: [{ price: { id: priceId } }] },
    })));

    expect(res.status).toBe(200);
    expect(lastTenantUpdate()).toEqual(expect.objectContaining({ planId: plan, status: 'active' }));
    // Exact payload match — no pointless API retrieval.
    expect(getCheckoutSession).not.toHaveBeenCalled();
  });

  it('expanded subscription item price also resolves without a fetch', async () => {
    const res = await POST(makeRequest(checkoutEvent({
      subscription: { id: 'sub_test_1', items: { data: [{ price: { id: 'price_pro_monthly' } }] } },
    })));

    expect(res.status).toBe(200);
    expect(lastTenantUpdate()).toEqual(expect.objectContaining({ planId: 'pro', status: 'active' }));
    expect(getCheckoutSession).not.toHaveBeenCalled();
  });
});

describe('#2303 unknown price id fails closed (no activation, admin alerted, still ACK 200)', () => {
  it('unmapped line_items price -> past_due, no planId, telegram + logError, 200 ACK', async () => {
    const res = await POST(makeRequest(checkoutEvent({
      subscription: 'sub_test_1',
      line_items: { data: [{ price: { id: 'price_never_configured_xyz' } }] },
      // Even the old heuristic inputs are present — they must be IGNORED:
      amount_total: 7900,
    })));

    // ACK so Stripe does not retry forever (repo convention for handled events).
    expect(res.status).toBe(200);

    const written = lastTenantUpdate();
    expect(written).toBeDefined();
    expect(written!['status']).toBe('past_due');
    expect(written).not.toHaveProperty('planId');
    expect(written!['status']).not.toBe('active');

    // Loudly recorded: logError + admin alert.
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'webhooks/stripe unmapped checkout price' }),
    );
    expect(sendAdminTelegram).toHaveBeenCalledTimes(1);

    // A known-unmapped price id never triggers an API retrieval.
    expect(getCheckoutSession).not.toHaveBeenCalled();
  });

  it('the old `|| starter` coercion is gone: zero matches never write planId starter', async () => {
    getCheckoutSession.mockResolvedValueOnce({ id: SESSION_ID, subscription: 'sub_test_1' });

    const res = await POST(makeRequest(checkoutEvent({
      subscription: 'sub_test_1',
      amount_total: 1500,
    })));

    expect(res.status).toBe(200);
    const written = lastTenantUpdate();
    expect(written).toBeDefined();
    expect(written).not.toHaveProperty('planId');
  });
});

describe('#2303 amount heuristic removed — boundary values resolve conservatively', () => {
  beforeEach(() => {
    // Worst realistic case: neither the payload nor the retrieved session
    // carries a price id.
    getCheckoutSession.mockImplementation(async () => ({
      id: SESSION_ID,
      subscription: 'sub_test_1', // still a string on the retrieved object too
    }));
  });

  it.each([
    [2900, 'starter'],   // old heuristic: <= 2900 -> starter
    [7900, 'pro'],       // old heuristic: <= 7900 -> pro
    [50000, 'enterprise'], // old heuristic: else enterprise
  ])('amount_total %s no longer grants %s', async (amountTotal, grantedByOldHeuristic) => {
    const res = await POST(makeRequest(checkoutEvent({
      subscription: 'sub_test_1',
      amount_total: amountTotal,
    })));

    expect(res.status).toBe(200);
    const written = lastTenantUpdate();
    expect(written!['status']).toBe('past_due');
    expect(written).not.toHaveProperty('planId');
    expect(written).not.toHaveProperty('planId', grantedByOldHeuristic);
    expect(sendAdminTelegram).toHaveBeenCalledTimes(1);
  });

  it('attempts the Stripe retrieval exactly once for a price-less payload', async () => {
    await POST(makeRequest(checkoutEvent({ subscription: 'sub_test_1', amount_total: 2900 })));
    expect(getCheckoutSession).toHaveBeenCalledTimes(1);
    expect(getCheckoutSession).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe('#2303 realistic current-API shape is repaired via session retrieval', () => {
  it('string subscription + absent line_items -> retrieved expanded session resolves the plan', async () => {
    getCheckoutSession.mockResolvedValueOnce({
      id: SESSION_ID,
      subscription: { id: 'sub_test_1', items: { data: [{ price: { id: 'price_enterprise_monthly' } }] } },
    });

    const res = await POST(makeRequest(checkoutEvent({ subscription: 'sub_test_1' })));

    expect(res.status).toBe(200);
    expect(getCheckoutSession).toHaveBeenCalledWith(SESSION_ID);
    expect(lastTenantUpdate()).toEqual(
      expect.objectContaining({ planId: 'enterprise', status: 'active', stripeSubscriptionId: 'sub_test_1' }),
    );
    expect(sendAdminTelegram).not.toHaveBeenCalled();
  });

  it('retrieved session carries an UNMAPPED price -> fail closed too', async () => {
    getCheckoutSession.mockResolvedValueOnce({
      id: SESSION_ID,
      subscription: { id: 'sub_test_1', items: { data: [{ price: { id: 'price_localized_inr_999' } }] } },
    });

    const res = await POST(makeRequest(checkoutEvent({ subscription: 'sub_test_1', amount_total: 99900 })));

    expect(res.status).toBe(200);
    const written = lastTenantUpdate();
    expect(written!['status']).toBe('past_due');
    expect(written).not.toHaveProperty('planId');
    expect(sendAdminTelegram).toHaveBeenCalledTimes(1);
  });

  it('Stripe retrieval throwing an error fails closed and still ACKs 200', async () => {
    getCheckoutSession.mockRejectedValueOnce(new Error('Stripe API 429'));

    const res = await POST(makeRequest(checkoutEvent({ subscription: 'sub_test_1', amount_total: 7900 })));

    expect(res.status).toBe(200);
    const written = lastTenantUpdate();
    expect(written!['status']).toBe('past_due');
    expect(written).not.toHaveProperty('planId');
    expect(sendAdminTelegram).toHaveBeenCalledTimes(1);
  });
});

describe('#2303 planFromPriceId catalog is the single source of truth', () => {
  it('maps every configured id, returns null for anything else', () => {
    expect(planFromPriceId('price_pro_yearly')).toBe('pro');
    expect(planFromPriceId('price_starter_monthly')).toBe('starter');
    expect(planFromPriceId('price_unknown')).toBeNull();
    expect(planFromPriceId('')).toBeNull();
    expect(planFromPriceId(null)).toBeNull();
    delete process.env['STRIPE_PRICE_ENTERPRISE_MONTHLY'];
    expect(planFromPriceId('price_enterprise_monthly')).toBeNull();
  });

  it('never resolves a plan from amounts (heuristic function is gone)', async () => {
    const mod = await import('@/lib/stripe-plan-resolution');
    expect(Object.keys(mod).sort()).toEqual(
      ['planFromPriceId', 'priceIdFromCheckoutPayload', 'priceIdFromSubscription', 'resolveCheckoutPlan'].sort(),
    );
  });
});
