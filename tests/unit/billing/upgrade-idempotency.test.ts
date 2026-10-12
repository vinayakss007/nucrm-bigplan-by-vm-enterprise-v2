/**
 * Tests for POST /api/tenant/billing/subscription/upgrade — issue #2228.
 *
 * The route used to call Stripe's updateSubscription() (which re-prices and
 * prorates) with NO idempotency key, BEFORE the local db.transaction wrote
 * subscriptions + billing_events. A client retry after a tx failure — or a
 * plain double-click — therefore applied proration twice.
 *
 * Fixed flow asserted here:
 *   1. a deterministic Idempotency-Key derived from the INTENT
 *      (tenant, stripe sub, from-plan → to-plan, interval) is passed to
 *      updateSubscription; two HTTP calls reproduce ONE key;
 *   2. the `subscription.upgrade_attempted` marker is persisted BEFORE the
 *      Stripe call;
 *   3. Stripe failure → `subscription.upgrade_failed` marker, no local tx;
 *   4. local tx failure after Stripe success → `subscription.upgrade_desynced`
 *      marker, and the retry reproduces the SAME key (so Stripe replays
 *      instead of charging again).
 *
 * Uses the thenable-db mock pattern from tests/unit/invoice-send-route.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const TENANT = 'a1111111-1111-4111-8111-111111111111';
const SUB_ID = 'b2222222-2222-4222-8222-222222222222';
const STRIPE_SUB = 'sub_1234567890';

const m = vi.hoisted(() => {
  const state = {
    markers: [] as Array<Record<string, unknown>>,
    txEventInserts: [] as Array<Record<string, unknown>>,
    txUpdateSets: [] as Array<Record<string, unknown>>,
    txCalls: 0,
    txShouldFail: false,
  };

  const tx = {
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        state.txUpdateSets.push(payload);
        return { where: vi.fn(async () => undefined) };
      },
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.txEventInserts.push(values);
      }),
    })),
  };

  const db = {
    query: {
      subscriptions: {
        findFirst: vi.fn(async () => ({
          id: SUB_ID,
          tenantId: TENANT,
          planId: 'starter',
          status: 'active',
          stripeSubscriptionId: STRIPE_SUB,
          currentPeriodStart: new Date('2026-09-01'),
          currentPeriodEnd: new Date('2026-10-01'),
          cancelAtPeriodEnd: false,
          metadata: {},
        })),
      },
      plans: {
        // Discriminated by the (mocked) eq(plans.id, <planId>) where clause.
        findFirst: vi.fn(async (_args?: unknown) => undefined as unknown),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        state.markers.push(values);
      }),
    })),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => {
      state.txCalls += 1;
      if (state.txShouldFail) throw new Error('db write failed: could not serialize access');
      return cb(tx);
    }),
  };

  return { state, db, tx };
});

vi.mock('@/drizzle/db', () => ({ db: m.db }));
vi.mock('@/drizzle/schema', () => ({
  subscriptions: { id: 'subscriptions.id', tenantId: 'subscriptions.tenant_id' },
  plans: { id: 'plans.id' },
  billingEvents: { id: 'billing_events.id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'admin-1', isAdmin: true })),
  requireCsrf: vi.fn(() => null),
}));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));
vi.mock('@/lib/api/validate', async () => {
  const { NextResponse } = await import('next/server');
  return {
    readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
    validateBody: vi.fn((schema: { safeParse: (d: unknown) => { success: boolean; data?: unknown } }, data: unknown) => {
      const r = schema.safeParse(data);
      return r.success
        ? { data: r.data }
        : NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }),
  };
});
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn(() => true),
  getPriceId: vi.fn(() => 'price_pro_monthly'),
  updateSubscription: vi.fn(async () => ({ id: STRIPE_SUB, status: 'active' })),
  getSubscriptionPeriodStart: vi.fn(() => 1759276800),
  getSubscriptionPeriodEnd: vi.fn(() => 1761955200),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/lib/api-error', async () => {
  const { NextResponse } = await import('next/server');
  return {
    apiError: vi.fn((err: unknown) =>
      NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
    ),
  };
});

import { updateSubscription } from '@/lib/stripe';
import { deriveUpgradeIdempotencyKey } from '@/lib/billing-idempotency';
import { POST } from '@/app/api/tenant/billing/subscription/upgrade/route';

function upgradeRequest(body: Record<string, unknown> = { planId: 'pro', interval: 'month' }) {
  return new Request('http://localhost:3000/api/tenant/billing/subscription/upgrade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const EXPECTED_KEY = deriveUpgradeIdempotencyKey({
  tenantId: TENANT,
  stripeSubscriptionId: STRIPE_SUB,
  fromPlanId: 'starter',
  toPlanId: 'pro',
  interval: 'month',
});

beforeEach(() => {
  vi.clearAllMocks();
  m.state.markers = [];
  m.state.txEventInserts = [];
  m.state.txUpdateSets = [];
  m.state.txCalls = 0;
  m.state.txShouldFail = false;
  const PLANS: Record<string, { id: string; name: string; priceMonthly: string }> = {
    pro: { id: 'pro', name: 'Pro', priceMonthly: '50.00' },
    enterprise: { id: 'enterprise', name: 'Enterprise', priceMonthly: '200.00' },
    starter: { id: 'starter', name: 'Starter', priceMonthly: '20.00' },
  };
  m.db.query.plans.findFirst.mockImplementation(async (args?: { where?: { eq?: [unknown, unknown] } }) => {
    const pid = String(args?.where?.eq?.[1] ?? '');
    return PLANS[pid] ?? null;
  });
});

describe('POST .../subscription/upgrade — Stripe idempotency (#2228)', () => {
  it('passes a deterministic intent-derived idempotency key to updateSubscription', async () => {
    const res = await POST(upgradeRequest());
    expect(res.status).toBe(200);
    expect(updateSubscription).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateSubscription).mock.calls[0]![1]).toMatchObject({
      priceId: 'price_pro_monthly',
      idempotencyKey: EXPECTED_KEY,
    });
    expect(EXPECTED_KEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two HTTP calls (double-click / retry) reproduce the SAME key — one charge intent', async () => {
    await POST(upgradeRequest());
    m.db.query.plans.findFirst.mockClear();
    await POST(upgradeRequest());

    const keys = vi.mocked(updateSubscription).mock.calls.map((c) => (c[1] as { idempotencyKey?: string }).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('a different intent (different target plan) yields a DIFFERENT key', async () => {
    await POST(upgradeRequest({ planId: 'pro', interval: 'month' }));
    m.db.query.plans.findFirst.mockClear();
    await POST(upgradeRequest({ planId: 'enterprise', interval: 'month' }));

    const keys = vi.mocked(updateSubscription).mock.calls.map((c) => (c[1] as { idempotencyKey?: string }).idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('persists the upgrade_attempted marker BEFORE the Stripe call', async () => {
    await POST(upgradeRequest());

    const attempted = m.state.markers.filter((x) => x.eventType === 'subscription.upgrade_attempted');
    expect(attempted).toHaveLength(1);
    expect(attempted[0]!.metadata).toMatchObject({ idempotency_key: EXPECTED_KEY, new_plan_id: 'pro' });
    expect(m.db.insert.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(updateSubscription).mock.invocationCallOrder[0]);
  });

  it('Stripe failure marks the attempt failed, never opens the local tx, and errors', async () => {
    vi.mocked(updateSubscription).mockRejectedValueOnce(new Error('card_declined'));

    const res = await POST(upgradeRequest());
    expect(res.status).toBe(500);
    expect(m.db.transaction).not.toHaveBeenCalled();
    const failed = m.state.markers.filter((x) => x.eventType === 'subscription.upgrade_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.metadata).toMatchObject({ idempotency_key: EXPECTED_KEY, error: 'card_declined' });
    // No success event was ever recorded
    expect(m.state.txEventInserts).toHaveLength(0);
  });

  it('DB-tx failure after Stripe success marks desync — the retry replays with the SAME key', async () => {
    m.state.txShouldFail = true;

    const first = await POST(upgradeRequest());
    expect(first.status).toBe(500);

    const desynced = m.state.markers.filter((x) => x.eventType === 'subscription.upgrade_desynced');
    expect(desynced).toHaveLength(1);
    expect(desynced[0]!.metadata).toMatchObject({
      idempotency_key: EXPECTED_KEY,
      new_plan_id: 'pro',
      stripe_period_end: 1761955200,
    });

    // Client retry: the DB plan row never changed (tx rolled back), so the
    // derived intent — and therefore the Stripe idempotency key — is
    // identical; Stripe replays the first response instead of charging again.
    m.db.query.plans.findFirst.mockClear();
    m.state.txShouldFail = false;
    const second = await POST(upgradeRequest());
    expect(second.status).toBe(200);

    const keys = vi.mocked(updateSubscription).mock.calls.map((c) => (c[1] as { idempotencyKey?: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    // And the healed retry wrote the real subscription row + success event
    expect(m.state.txUpdateSets).toHaveLength(1);
    expect(m.state.txUpdateSets[0]).toMatchObject({ planId: 'pro', status: 'active' });
    expect(m.state.txEventInserts[0]).toMatchObject({ eventType: 'subscription.upgraded' });
  });
});
