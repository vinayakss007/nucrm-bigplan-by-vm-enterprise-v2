/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 (PR-2E) — Billing permission gates.
 *
 * The billing surface used to gate every handler on `ctx.isAdmin`, so the
 * catalog ids `billing.view` and `billing.manage` were grantable from the Roles
 * UI and read by nobody. This pins the entity-wide replacement:
 *
 *   - reads require `billing.view`
 *   - writes require `billing.manage`
 *
 * Both halves matter. The source guard proves every handler in
 * `app/api/tenant/billing/` names a permission (a new route cannot silently
 * ship an `isAdmin`-only or ungated handler). The behavioural tests prove the
 * gate actually answers 403 before any query runs, and that a grant, an admin,
 * or a superadmin still gets through.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth/middleware';

import { GET as getCheckout, POST as postCheckout } from '@/app/api/tenant/billing/checkout/route';
import { GET as getDunning, POST as postDunning } from '@/app/api/tenant/billing/dunning/route';
import { GET as getDunningRetry, POST as postDunningRetry } from '@/app/api/tenant/billing/dunning/retry/route';
import { GET as getInvoices } from '@/app/api/tenant/billing/invoices/route';
import { POST as postModules } from '@/app/api/tenant/billing/modules/route';
import { POST as postPayU } from '@/app/api/tenant/billing/payu/route';
import { POST as postPortal } from '@/app/api/tenant/billing/portal/route';
import { POST as postRazorpay } from '@/app/api/tenant/billing/razorpay/route';
import { POST as postStripePortal } from '@/app/api/tenant/billing/stripe/route';
import { POST as postCancel } from '@/app/api/tenant/billing/subscription/cancel/route';
import { POST as postDowngrade } from '@/app/api/tenant/billing/subscription/downgrade/route';
import { POST as postResume } from '@/app/api/tenant/billing/subscription/resume/route';
import { GET as getSubscription } from '@/app/api/tenant/billing/subscription/route';
import { POST as postUpgrade } from '@/app/api/tenant/billing/subscription/upgrade/route';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROOT = join(process.cwd());
const BILLING_DIR = 'app/api/tenant/billing';

let currentCtx: AuthContext;

function member(permissions: Record<string, boolean> = {}): AuthContext {
  return {
    userId: USER,
    tenantId: TENANT,
    roleSlug: 'sales_rep',
    permissions,
    isAdmin: false,
    isSuperAdmin: false,
  } as unknown as AuthContext;
}

vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <H>(handler: H): H => handler,
}));

vi.mock('@/lib/api/mutating-rate-limit', () => ({
  rateLimitMutating: vi.fn(async () => null),
}));

vi.mock('@/lib/errors-server', () => ({
  logError: vi.fn(async () => undefined),
  tenantMeta: vi.fn(() => ({})),
}));

vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => currentCtx),
    // CSRF is a separate layer; these tests exercise authorization, not it.
    requireCsrf: vi.fn(() => null),
  };
});

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn(() => false),
  createCheckoutSession: vi.fn(async () => ({ url: 'https://stripe.test/checkout' })),
  createPortalSession: vi.fn(async () => ({ url: 'https://stripe.test/portal' })),
  getPriceId: vi.fn(() => 'price_test'),
  cancelSubscription: vi.fn(async () => ({ id: 'sub_test', status: 'canceled', currency: 'usd' })),
  resumeSubscription: vi.fn(async () => ({ id: 'sub_test', status: 'active', currency: 'usd' })),
  scheduleDowngradeAtPeriodEnd: vi.fn(async () => ({ id: 'sub_test' })),
  updateSubscription: vi.fn(async () => ({ id: 'sub_test' })),
  getSubscriptionPeriodStart: vi.fn(() => 1_700_000_000),
  getSubscriptionPeriodEnd: vi.fn(() => 1_700_200_000),
  stripeFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
}));

vi.mock('@/lib/payu', () => ({
  isPayUConfigured: vi.fn(() => false),
  createPaymentLink: vi.fn(() => ({})),
}));

vi.mock('@/lib/razorpay', () => ({
  isRazorpayConfigured: vi.fn(() => false),
  createOrder: vi.fn(async () => ({ id: 'order_test' })),
  getPlanAmount: vi.fn(() => 1000),
}));

vi.mock('@/lib/modules/registry', () => ({
  BUILTIN_MODULES: [],
}));

function chain(result: unknown) {
  const node: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy', 'limit', 'offset', 'innerJoin', 'leftJoin', 'groupBy']) {
    node[method] = () => node;
  }
  node['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return node;
}

const dbSelect = vi.fn(() => chain([]));
const dbInsert = vi.fn((_table?: unknown) => ({
  values: () => ({ returning: async () => [{ id: 'dunning-1' }] }),
}));
const dbUpdate = vi.fn((_table?: unknown) => ({
  set: () => ({ where: async () => undefined }),
}));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: () => dbSelect(),
    insert: (table: unknown) => dbInsert(table),
    update: (table: unknown) => dbUpdate(table),
    query: {
      subscriptions: { findFirst: vi.fn(async () => null) },
      plans: { findFirst: vi.fn(async () => null) },
      billingEvents: { findMany: vi.fn(async () => []) },
      dunningSettings: { findFirst: vi.fn(async () => null) },
      dunningAttempts: { findMany: vi.fn(async () => []) },
    },
  },
}));

function request(path: string, method = 'GET', body?: unknown): NextRequest {
  const init: ConstructorParameters<typeof NextRequest>[1] = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return new NextRequest(new URL(path, 'http://localhost:3000'), init);
}

// Route handlers carry a second (context) parameter that these tests never use.
type Handler = (request: NextRequest) => Promise<Response>;
const call = (handler: unknown, req: NextRequest) => (handler as Handler)(req);

interface RouteCase {
  name: string;
  perm: 'billing.view' | 'billing.manage';
  fn: () => Promise<Response>;
  grantedStatus: number;
}

const ROUTES: RouteCase[] = [
  { name: 'POST /billing/checkout', perm: 'billing.manage', fn: () => call(postCheckout, request('/api/tenant/billing/checkout', 'POST', { plan: 'pro', interval: 'month' })), grantedStatus: 503 },
  { name: 'GET /billing/checkout', perm: 'billing.view', fn: () => call(getCheckout, request('/api/tenant/billing/checkout')), grantedStatus: 503 },
  { name: 'GET /billing/dunning', perm: 'billing.view', fn: () => call(getDunning, request('/api/tenant/billing/dunning')), grantedStatus: 200 },
  { name: 'POST /billing/dunning', perm: 'billing.manage', fn: () => call(postDunning, request('/api/tenant/billing/dunning', 'POST', {})), grantedStatus: 200 },
  { name: 'GET /billing/dunning/retry', perm: 'billing.view', fn: () => call(getDunningRetry, request('/api/tenant/billing/dunning/retry')), grantedStatus: 400 },
  { name: 'POST /billing/dunning/retry', perm: 'billing.manage', fn: () => call(postDunningRetry, request('/api/tenant/billing/dunning/retry', 'POST', { subscriptionId: '11111111-1111-4111-8111-111111111111' })), grantedStatus: 503 },
  { name: 'GET /billing/invoices', perm: 'billing.view', fn: () => call(getInvoices, request('/api/tenant/billing/invoices')), grantedStatus: 200 },
  { name: 'POST /billing/modules', perm: 'billing.manage', fn: () => call(postModules, request('/api/tenant/billing/modules', 'POST', { moduleId: 'ai-assistant' })), grantedStatus: 503 },
  { name: 'POST /billing/payu', perm: 'billing.manage', fn: () => call(postPayU, request('/api/tenant/billing/payu', 'POST', {})), grantedStatus: 503 },
  { name: 'POST /billing/portal', perm: 'billing.manage', fn: () => call(postPortal, request('/api/tenant/billing/portal', 'POST')), grantedStatus: 503 },
  { name: 'POST /billing/razorpay', perm: 'billing.manage', fn: () => call(postRazorpay, request('/api/tenant/billing/razorpay', 'POST', { plan: 'pro', interval: 'month' })), grantedStatus: 503 },
  { name: 'POST /billing/stripe', perm: 'billing.manage', fn: () => call(postStripePortal, request('/api/tenant/billing/stripe', 'POST')), grantedStatus: 503 },
  { name: 'POST /billing/subscription/cancel', perm: 'billing.manage', fn: () => call(postCancel, request('/api/tenant/billing/subscription/cancel', 'POST', {})), grantedStatus: 503 },
  { name: 'POST /billing/subscription/downgrade', perm: 'billing.manage', fn: () => call(postDowngrade, request('/api/tenant/billing/subscription/downgrade', 'POST', { planId: 'pro' })), grantedStatus: 503 },
  { name: 'POST /billing/subscription/resume', perm: 'billing.manage', fn: () => call(postResume, request('/api/tenant/billing/subscription/resume', 'POST')), grantedStatus: 503 },
  { name: 'GET /billing/subscription', perm: 'billing.view', fn: () => call(getSubscription, request('/api/tenant/billing/subscription')), grantedStatus: 200 },
  { name: 'POST /billing/subscription/upgrade', perm: 'billing.manage', fn: () => call(postUpgrade, request('/api/tenant/billing/subscription/upgrade', 'POST', { planId: 'pro', interval: 'month' })), grantedStatus: 503 },
];

describe('#3402 (PR-2E) — billing permission source guard', () => {
  const EXPECTED: Record<string, { method: 'GET' | 'POST'; perm: string }[]> = {
    'checkout/route.ts': [
      { method: 'POST', perm: 'billing.manage' },
      { method: 'GET', perm: 'billing.view' },
    ],
    'dunning/route.ts': [
      { method: 'GET', perm: 'billing.view' },
      { method: 'POST', perm: 'billing.manage' },
    ],
    'dunning/retry/route.ts': [
      { method: 'POST', perm: 'billing.manage' },
      { method: 'GET', perm: 'billing.view' },
    ],
    'invoices/route.ts': [{ method: 'GET', perm: 'billing.view' }],
    'modules/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'payu/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'portal/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'razorpay/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'stripe/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'subscription/cancel/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'subscription/downgrade/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'subscription/resume/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
    'subscription/route.ts': [{ method: 'GET', perm: 'billing.view' }],
    'subscription/upgrade/route.ts': [{ method: 'POST', perm: 'billing.manage' }],
  };

  it('enumerates every handler in the billing tree, so a new route fails this test', () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (entry.name === 'route.ts') found.push(path.replace(`${BILLING_DIR}/`, ''));
      }
    };
    walk(BILLING_DIR);
    expect(found.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s names requirePerm on every handler', (file, gates) => {
    const source = readFileSync(join(ROOT, BILLING_DIR, file), 'utf8');
    for (const { method, perm } of gates) {
      const handler = source.slice(source.indexOf(`export const ${method}`));
      expect(handler).toContain(`requirePerm(ctx, '${perm}')`);
    }
  });

  it('leaves no isAdmin-only gate in the billing tree', () => {
    for (const file of Object.keys(EXPECTED)) {
      const source = readFileSync(join(ROOT, BILLING_DIR, file), 'utf8');
      expect(source).not.toContain('ctx.isAdmin');
    }
  });
});

describe('#3402 (PR-2E) — billing permission enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    currentCtx = member();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(ROUTES)('$name denies (403) when $perm is missing', async ({ fn, perm }) => {
    const res = await fn();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(`Permission denied: ${perm} required`);
    // The gate runs before business logic: no read and no write happened.
    expect(dbSelect).not.toHaveBeenCalled();
    expect(dbInsert).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it.each(ROUTES)('$name allows a $perm grant', async ({ fn, perm, grantedStatus }) => {
    currentCtx = member({ [perm]: true });
    const res = await fn();
    expect(res.status).toBe(grantedStatus);
  });

  it.each(ROUTES)('$name allows an admin', async ({ fn, grantedStatus }) => {
    currentCtx = { ...member(), isAdmin: true } as AuthContext;
    const res = await fn();
    expect(res.status).toBe(grantedStatus);
  });

  it.each(ROUTES)('$name allows a superadmin', async ({ fn, grantedStatus }) => {
    currentCtx = { ...member(), isSuperAdmin: true } as AuthContext;
    const res = await fn();
    expect(res.status).toBe(grantedStatus);
  });
});
