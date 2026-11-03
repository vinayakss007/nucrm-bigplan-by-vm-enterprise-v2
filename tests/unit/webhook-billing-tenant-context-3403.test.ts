/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3403 — `POST /api/webhooks/razorpay` and `POST /api/webhooks/stripe` answered 200
 * while changing nothing.
 *
 * Both routes authenticate by HMAC over the raw body, which is why #1838's guard hands
 * them to `skippedAuthenticators`: a signature proves the SENDER, so there is no tenant
 * to open with before the first statement. What they then did was write anyway — eight
 * `db.update(tenants)` on the bare pool, plus the `subscriptions` writes #2530 put in a
 * transaction that named no workspace either.
 *
 * `tenants` is FORCE-RLS (0088:70) and its only UPDATE arm, `tenants_authenticated_update`
 * (0054:151-153), opens on `current_setting('app.current_user', true) != ''`. `pool.ts`
 * normalises every checkout with that GUC at '', so the arm admits nothing, an UPDATE
 * matches zero rows, and zero rows is not an error — it is a 200. Migration 0100 wrote
 * that shape down in words ("UPDATE … rowCount = 0 (silent) … every job logged success
 * while changing nothing"); this suite is the webhook instance of it.
 *
 * Measured against the dev database as `nucrm_app` on 2026-11-03 (temp FORCE-RLS tables
 * carrying the 0054 `tenants` arms and the 0031 `subscriptions` isolation, two seeded
 * workspaces, in a rollback): `UPDATE tenants … WHERE id = <A>` is 0 rows with no context
 * and 1 with `app.current_user` set transaction-locally; `UPDATE subscriptions … WHERE
 * stripe_subscription_id = …` is 0 rows unless `app.current_tenant` names the owner, and
 * still 0 when the GUC names a *different* tenant — which is why the context is taken from
 * the payload's own workspace and not widened. A `app.is_super_admin='true'` context would
 * also move the row, and is refused here on purpose: the callback's tenant id arrives from a
 * request body, so the privilege has to be exactly the one workspace the payload names.
 *
 * So these tests pin the shape of the fix rather than its existence: one transaction per
 * event, the workspace named before any write, the actor half set to the nil sentinel
 * (non-empty, so `tenants_authenticated_update` admits it, matching no `users` row, so
 * nothing keyed on the actor opens), no super-admin flag, the tenant row's existence
 * reported instead of assumed, and #2530's pair still committing together inside it.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { getTableName } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

const ROOT = join(import.meta.dirname!, '../..');
const dialect = new PgDialect();
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const NIL = '00000000-0000-0000-0000-000000000000';
const SUB_ID = 'sub_1ThreeFortyThree';

const RAZORPAY_ROUTE = 'app/api/webhooks/razorpay/route.ts';
const STRIPE_ROUTE = 'app/api/webhooks/stripe/route.ts';
const CONTEXT = 'lib/db/billing-webhook-context.ts';

type AnyObj = Record<string, unknown>;
interface SqlCall { sql: string; params: unknown[] }

const H = vi.hoisted(() => ({
  ops: [] as string[],
  calls: [] as SqlCall[],
  /** What an UPDATE reports it moved. 0 is the defect this issue is about. */
  rowCount: 1,
  /** `db.query.tenants.findFirst` — the context-free read 0054's tenants_read_all allows. */
  tenantRow: undefined as unknown,
  status: 'active',
}));

const ops = () => H.ops as string[];
const configs = () => (H.calls as SqlCall[]).filter((c) => c.sql.includes('set_config'));
const updates = () => (H.ops as string[]).filter((o) => o.startsWith('update:'));

/**
 * A write is only honest if the transaction issuing it named a workspace: on the base
 * revision every statement below ran on the pool with both GUCs at '', moved nothing, and
 * the route still answered `{received:true}`.
 */
function assertContextBeforeWrites() {
  let named = false;
  for (const o of ops()) {
    if (o === 'BEGIN') { named = false; continue; }
    if (o === 'ctx:billing') { named = true; continue; }
    if (o.startsWith('update:') || o.startsWith('insert:')) {
      expect(named, `${o} ran on a handle whose transaction never named a workspace`).toBe(true);
    }
  }
}

function recordExecute(f: unknown) {
  const c = dialect.sqlToQuery(f as Parameters<PgDialect['sqlToQuery']>[0]);
  const call: SqlCall = { sql: c.sql, params: c.params };
  (H.calls as SqlCall[]).push(call);
  if (call.sql.includes('app.current_tenant') || call.params.includes('app.current_tenant')) {
    (H.ops as string[]).push('ctx:billing');
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}

function selectChainFor(name: string) {
  const chain: AnyObj = {
    where() { return chain; },
    limit() { return chain; },
    then(onFulfilled: (rows: unknown[]) => unknown) {
      (H.ops as string[]).push(`select:${name}`);
      return Promise.resolve(H.tenantRow ? [H.tenantRow] : []).then(onFulfilled);
    },
  };
  return chain;
}

const fakeTx = () => ({
  execute: (f: unknown) => recordExecute(f),
  select: () => ({ from: (t: object) => selectChainFor(getTableName(t as never)) }),
  update(table: object) {
    const name = getTableName(table as never);
    return {
      set(values: Record<string, unknown>) {
        (H.ops as string[]).push(`update:${name}:${Object.keys(values).sort().join(',')}`);
        return { where: () => Promise.resolve({ rowCount: H.rowCount }) };
      },
    };
  },
  insert(table: object) {
    const name = getTableName(table as never);
    return {
      values: () => {
        (H.ops as string[]).push(`insert:${name}`);
        return Promise.resolve({ rowCount: H.rowCount });
      },
    };
  },
});

vi.mock('@/drizzle/db', () => ({
  db: {
    execute: (f: unknown) => recordExecute(f),
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      (H.ops as string[]).push('BEGIN');
      const result = await cb(fakeTx());
      (H.ops as string[]).push('COMMIT');
      return result;
    },
    query: {
      tenants: {
        findFirst: async () => {
          (H.ops as string[]).push('read:tenants');
          return H.tenantRow ? { ...H.tenantRow, status: H.status } : undefined;
        },
      },
    },
  },
}));

vi.mock('@/lib/db/request-connection', () => ({
  withPinnedConnection: <T>(fn: () => Promise<T>): Promise<T> => fn(),
  getPinnedClient: () => undefined,
}));

const razorpayState = vi.hoisted(() => ({ configured: true, plan: 'pro' }));
vi.mock('@/lib/razorpay', () => ({
  isRazorpayConfigured: () => razorpayState.configured,
  verifyWebhookSignature: vi.fn(async () => undefined),
  RazorpaySignatureError: class RazorpaySignatureError extends Error {},
  normalizeRazorpayPlan: () => razorpayState.plan,
}));

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  verifyWebhookSignature: async (body: string) => JSON.parse(body),
  StripeError: class StripeError extends Error {},
}));

const checkoutPlan = vi.hoisted(() => ({ ok: true as boolean, planId: 'pro', priceId: 'price_pro_monthly', reason: '', resolution: undefined as unknown }));
vi.mock('@/lib/stripe-plan-resolution', () => ({
  resolveCheckoutPlan: async () => (checkoutPlan.resolution ?? (checkoutPlan.ok
    ? { ok: true, planId: checkoutPlan.planId, priceId: checkoutPlan.priceId, source: 'subscription' }
    : { ok: false, planId: null, priceId: checkoutPlan.priceId, reason: checkoutPlan.reason || 'unmapped_price' })),
  planFromPriceId: () => checkoutPlan.planId,
  priceIdFromSubscription: () => checkoutPlan.priceId,
}));

vi.mock('@/lib/cache/index', () => ({
  acquireLock: vi.fn(async () => ({ acquired: true, value: 'lock-val' })),
  releaseLock: vi.fn(async () => undefined),
}));
const idem = vi.hoisted(() => ({ released: 0, completed: 0 }));
vi.mock('@/lib/webhooks/idempotency', () => ({
  claimWebhookEvent: vi.fn(async () => true),
  completeWebhookEvent: vi.fn(async () => { idem.completed += 1; }),
  releaseWebhookEvent: vi.fn(async () => { idem.released += 1; }),
}));
vi.mock('@/lib/webhooks', () => ({ fireWebhooks: vi.fn(async () => undefined) }));
vi.mock('@/lib/automation/engine', () => ({ evaluateAutomations: vi.fn(async () => undefined) }));
vi.mock('@/lib/telegram-admin', () => ({ sendAdminTelegram: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const logged = vi.hoisted(() => [] as Array<{ context?: string; level?: string }>);
vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async (arg: { context?: string; level?: string }) => { logged.push(arg); }),
}));
vi.mock('@/lib/api-error', () => ({
  apiError: (_e: unknown, msg = 'Bad request', status = 400) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}));

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function razorpayPost(event: unknown, headers: Record<string, string> = {}): NextRequest {
  const body = JSON.stringify(event);
  return new Request('http://localhost/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'sig', ...headers },
    body,
  }) as unknown as NextRequest;
}

function stripePost(event: unknown): NextRequest {
  const body = JSON.stringify(event);
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=sig' },
    body,
  }) as unknown as NextRequest;
}

function razorpayEvent(event: string, entity: AnyObj) {
  const key = event.startsWith('payment') ? 'payment' : 'subscription';
  return { event, payload: { [key]: { entity: { id: `${key}_1`, ...entity } } } };
}

function stripeEvent(type: string, object: AnyObj) {
  return { id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } };
}

beforeEach(() => {
  H.ops = [];
  H.calls = [];
  H.rowCount = 1;
  H.tenantRow = { id: TENANT_A };
  H.status = 'active';
  idem.released = 0;
  idem.completed = 0;
  logged.length = 0;
  checkoutPlan.ok = true;
  checkoutPlan.planId = 'pro';
  checkoutPlan.priceId = 'price_pro_monthly';
  checkoutPlan.reason = '';
  checkoutPlan.resolution = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the billing callback names a workspace before it writes one', () => {
  for (const [event, entity] of [
    ['payment.captured', { notes: { tenant_id: TENANT_A, plan_id: 'growth' } }],
    ['subscription.activated', { id: 'sub_1', notes: { tenant_id: TENANT_A, plan_id: 'scale' } }],
    ['subscription.cancelled', { id: 'sub_1', notes: { tenant_id: TENANT_A } }],
    ['payment.failed', { notes: { tenant_id: TENANT_A } }],
  ] as Array<[string, AnyObj]>) {
    it(`${event} updates tenants inside a transaction that named the payload's workspace`, async () => {
      const { POST } = await import('@/app/api/webhooks/razorpay/route');
      const res = await POST(razorpayPost(razorpayEvent(event, entity)));

      expect(res.status).toBe(200);
      expect(updates()).toEqual(expect.arrayContaining([expect.stringContaining('update:tenants')]));
      assertContextBeforeWrites();
      // One transaction: the context statement and the write share a handle, so the
      // SET LOCAL cannot be lost to another checkout under transaction pooling.
      expect(ops().filter((o) => o === 'BEGIN')).toHaveLength(1);
    });
  }

  it('the context is transaction-local, carries the payload tenant, and never a super-admin flag', async () => {
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    await POST(razorpayPost(razorpayEvent('payment.captured', { notes: { tenant_id: TENANT_A } })));

    const [cfg] = configs();
    expect(cfg!.sql).toContain('app.current_tenant');
    expect(cfg!.sql).toContain('app.current_user');
    expect(cfg!.sql).toMatch(/true/);           // is_local — SET LOCAL, not session
    expect(cfg!.params).toEqual([TENANT_A, NIL]); // the payload's tenant, the nil actor
    const allSql = (H.calls as SqlCall[]).map((c) => c.sql).join('\n');
    expect(allSql).not.toContain('app.is_super_admin');
  });

  it('a tenant_id that is not a uuid names no row, so nothing is attempted', async () => {
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    const res = await POST(
      razorpayPost(razorpayEvent('payment.captured', { notes: { tenant_id: 'tenant-not-a-uuid' } })),
    );

    // Postgres would answer `22P02` for the cast, and the callback would 500 forever on
    // an id that can never name a tenant. Refusing the write is the fail-closed half.
    expect(res.status).toBe(200);
    expect(updates()).toEqual([]);
    expect(ops()).toEqual([]);
  });

  it('missing notes are refused the same way they always were', async () => {
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    const res = await POST(razorpayPost(razorpayEvent('payment.captured', {})));
    expect(res.status).toBe(200);
    expect(updates()).toEqual([]);
  });
});

describe('the same callback tells "no such tenant" from "the policy refused"', () => {
  it('a tenant that is not in the database is reported and acked, not retried forever', async () => {
    H.tenantRow = undefined;
    H.rowCount = 0;
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    const res = await POST(
      razorpayPost(razorpayEvent('payment.captured', { notes: { tenant_id: TENANT_B } })),
    );

    // Retrying cannot conjure the row, so a 500 here only burns Razorpay's retries and
    // then disables the endpoint. It has to be loud in the logs instead.
    expect(res.status).toBe(200);
    expect(logged.some((l) => l.level === 'error' || l.context?.includes('razorpay'))).toBe(true);
  });

  it('a row that exists but will not move is a failure the provider must retry', async () => {
    H.rowCount = 0;
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    const res = await POST(
      razorpayPost(razorpayEvent('payment.captured', { notes: { tenant_id: TENANT_A } })),
    );

    expect(res.status).toBe(500);
    expect(idem.released).toBe(1);   // so Razorpay's retry is processed, not deduped away
  });

  it('a successful event closes the ledger claim', async () => {
    const { POST } = await import('@/app/api/webhooks/razorpay/route');
    await POST(razorpayPost(razorpayEvent('payment.captured', { notes: { tenant_id: TENANT_A } })));
    expect(idem.completed).toBe(1);
  });
});

describe('Stripe events land in the workspace the payload names', () => {
  it('checkout.session.completed activates inside one context', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('checkout.session.completed', {
      id: 'cs_test_1', customer: 'cus_1', subscription: 'sub_1',
      metadata: { tenant_id: TENANT_A },
    })));

    expect(res.status).toBe(200);
    expect(updates()).toEqual(['update:tenants:billingType,planId,status,stripeCustomerId,stripeSubscriptionId,updatedAt']);
    assertContextBeforeWrites();
  });

  it('the fail-closed branch keeps its past_due write under the same rule', async () => {
    checkoutPlan.ok = false;
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('checkout.session.completed', {
      id: 'cs_test_2', customer: 'cus_1', metadata: { tenant_id: TENANT_A },
    })));

    expect(res.status).toBe(200);
    expect(updates()).toEqual(['update:tenants:billingType,status,stripeCustomerId,stripeSubscriptionId,updatedAt']);
    assertContextBeforeWrites();
  });

  it('subscription.updated moves tenants and subscriptions in one contextualised transaction', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('customer.subscription.updated', {
      id: SUB_ID, status: 'active', metadata: { tenant_id: TENANT_A }, items: { data: [] },
    })));

    expect(res.status).toBe(200);
    expect(ops().filter((o) => o === 'BEGIN')).toHaveLength(1);
    expect(ops().indexOf('ctx:billing')).toBeLessThan(ops().indexOf('update:tenants:planId,status,updatedAt'));
    expect(updates()).toEqual([
      'update:tenants:planId,status,updatedAt',
      'update:subscriptions:planId,status,updatedAt',
    ]);
    assertContextBeforeWrites();
  });

  it('the terminal-status guard keeps its pair atomic and contextualised', async () => {
    H.status = 'suspended';
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('customer.subscription.updated', {
      id: SUB_ID, status: 'active', metadata: { tenant_id: TENANT_A }, items: { data: [] },
    })));

    expect(res.status).toBe(200);
    expect(ops().filter((o) => o === 'BEGIN')).toHaveLength(1);
    expect(updates()).toEqual(['update:tenants:planId,updatedAt', 'update:subscriptions:planId,status,updatedAt']);
    assertContextBeforeWrites();
  });

  it('subscription.deleted downgrades the tenant and retires the row under one context', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('customer.subscription.deleted', {
      id: SUB_ID, status: 'canceled', metadata: { tenant_id: TENANT_A }, items: { data: [] },
    })));

    expect(res.status).toBe(200);
    expect(ops().filter((o) => o === 'BEGIN')).toHaveLength(1);
    expect(updates()).toEqual([
      'update:tenants:billingType,planId,status,stripeSubscriptionId,updatedAt',
      'update:subscriptions:cancelAtPeriodEnd,status,updatedAt',
    ]);
    assertContextBeforeWrites();
  });

  it('a tenant the payload names but the database does not have is reported, not retried', async () => {
    H.tenantRow = undefined;
    H.rowCount = 0;
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('customer.subscription.updated', {
      id: SUB_ID, status: 'active', metadata: { tenant_id: TENANT_A }, items: { data: [] },
    })));

    expect(res.status).toBe(200);
    expect(logged.length).toBeGreaterThan(0);
    // The billing row is still reconciled inside the same transaction (#2228), and the
    // whole thing commits or rolls back together — never half of it.
    expect(updates()).toEqual([
      'update:tenants:planId,status,updatedAt',
      'update:subscriptions:planId,status,updatedAt',
    ]);
  });

  it('a tenants write that moves nothing while the row is visible takes the transaction down with it', async () => {
    H.rowCount = 0;   // the row IS visible (default tenantRow) — so this is a refusal, not a deletion
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('customer.subscription.updated', {
      id: SUB_ID, status: 'active', metadata: { tenant_id: TENANT_A }, items: { data: [] },
    })));

    expect(res.status).toBe(500);
    expect(idem.released).toBe(1);
    // #2530's property, now inside #3403's context: the billing row never got to move on
    // its own, so nothing half-committed.
    expect(updates()).toEqual(['update:tenants:planId,status,updatedAt']);
  });

  it('invoice.payment_succeeded resolves the tenant context-free and writes under it', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('invoice.payment_succeeded', {
      id: 'in_1', customer: 'cus_1', amount_paid: 4900, currency: 'usd',
    })));

    expect(res.status).toBe(200);
    // 0054's tenants_read_all is USING(true), so the by-customer lookup needs no context.
    // The write is what does.
    expect(ops()).toEqual(['read:tenants', 'BEGIN', 'ctx:billing', 'update:tenants:status,updatedAt', 'COMMIT']);
  });

  it('invoice.payment_failed flags past_due inside the context', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('invoice.payment_failed', {
      id: 'in_2', customer: 'cus_1', amount_paid: 4900,
    })));

    expect(res.status).toBe(200);
    expect(ops()).toEqual(['read:tenants', 'BEGIN', 'ctx:billing', 'update:tenants:status,updatedAt', 'COMMIT']);
  });

  it('an event whose customer matches no tenant writes nothing at all, as before', async () => {
    H.tenantRow = undefined;
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(stripePost(stripeEvent('invoice.payment_succeeded', {
      id: 'in_3', customer: 'cus_gone',
    })));
    expect(res.status).toBe(200);
    expect(updates()).toEqual([]);
  });
});

describe('the context module is the narrow one, not the wide one', () => {
  it('exists, and is the only place the billing callback sets a GUC', () => {
    const src = read(CONTEXT);
    expect(src).toContain('app.current_tenant');
    expect(src).toContain('NO_USER_SENTINEL');
    expect(src).not.toContain("set_config('app.is_super_admin'");
  });

  it('no provider callback writes a billing table through the pool any more', () => {
    // Comments describe the old code on purpose, so the screen is the test that has to
    // tell prose from a statement — see tests/unit/rls-guard-webhook-billing-writes-3403.test.ts.
    const src = read(RAZORPAY_ROUTE) + '\n' + read(STRIPE_ROUTE);
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|=\*|-)/.test(l))
      .join('\n');
    expect(code).not.toMatch(/\bdb\s*\.\s*(update|insert|delete)\s*\(\s*tenants\b/);
    expect(code).not.toMatch(/\bdb\s*\.\s*transaction\s*\(/);
  });

  it('refuses an empty workspace rather than opening a context that names nobody', async () => {
    const mod = await import('@/lib/db/billing-webhook-context');
    expect(mod.billingWebhookTenant(undefined)).toBeNull();
    expect(mod.billingWebhookTenant('')).toBeNull();
    expect(mod.billingWebhookTenant('11111111-1111-4111-8111-111111111111')).toBe(TENANT_A);
    await expect(mod.withBillingWebhookContext('not-a-uuid', async () => 1)).rejects.toThrow(/tenant/);
  });
});
