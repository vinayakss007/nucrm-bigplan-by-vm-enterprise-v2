/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3344 — the four Stripe-first subscription mirror writes (resume, cancel,
 * downgrade, upgrade) updated `subscriptions` with `WHERE id` alone, resting
 * tenancy entirely on the preceding unlocked `findFirst` — the exact pattern
 * #3194/#3342 eliminated everywhere else.
 *
 * What this family explicitly does NOT do here: pin a from-status claim.
 * Stripe is the authority and these writes merely mirror its answer; a lost
 * claim after a successful Stripe mutation would leave the row diverged with
 * no retry path (the #2228 idempotency key replays Stripe's first response,
 * never the DB write). The tenant clause is the whole fix.
 *
 * Coverage: the two simple flows (resume, cancel-immediate) run against a
 * mock pool with the UPDATE's WHERE rendered through `PgDialect` — proving
 * the predicate and its bound parameter, not a call count — and all four
 * sources are pinned statically so a future refactor cannot drop a clause
 * on the two flows too heavy to harness here (upgrade touches plans/payment
 * methods, downgrade schedules a Stripe subscription schedule).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const REPO = process.cwd();
const dialect = new PgDialect({} as never);

const TENANT = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB_ID = '55555555-5555-4555-8555-555555555555';

type Captured = { sql: string; params: unknown[]; set: Record<string, unknown> };

const state = {
  subRow: null as unknown,
  updates: [] as Captured[],
  stripeResume: [] as string[],
  stripeCancel: [] as Array<{ id: string; atPeriodEnd: boolean }>,
};

function captureUpdate(): Record<string, unknown> {
  let rec: Captured = { sql: '', params: [], set: {} };
  const node: Record<string, unknown> = {
    set: (vals: Record<string, unknown>) => { rec = { ...rec, set: vals }; return node; },
    where: (pred: unknown) => {
      const rendered = dialect.sqlToQuery(pred as never);
      rec = { sql: rendered.sql, params: rendered.params, set: rec.set };
      state.updates.push(rec);
      return node;
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(res, rej),
  };
  return node;
}

const db: Record<string, unknown> = {
  query: {
    subscriptions: {
      findFirst: async () => state.subRow,
    },
  },
  transaction: async (cb: (tx: Record<string, unknown>) => Promise<unknown>) =>
    cb({
      update: () => captureUpdate(),
      insert: () => ({ values: async () => undefined }),
    }),
};

vi.mock('@/drizzle/db', () => ({ db }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return {
    ...actual,
    requireAuth: vi.fn(async () => ctx),
    requireCsrf: vi.fn(() => null),
  };
});
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: async () => undefined }));
vi.mock('@/lib/api/validate', () => ({
  readJsonBody: vi.fn(async (req: { json(): Promise<unknown> }) => req.json()),
  validateBody: vi.fn((_schema: unknown, body: unknown) => ({ data: body })),
}));
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  resumeSubscription: async (id: string) => {
    state.stripeResume.push(id);
    return { current_period_end: 1762000000 };
  },
  cancelSubscription: async (id: string, atPeriodEnd: boolean) => {
    state.stripeCancel.push({ id, atPeriodEnd });
    return { current_period_end: 1762000000 };
  },
}));
vi.mock('@/lib/api-error', () => ({
  apiError: vi.fn((err: unknown) => { throw err; }),
}));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));

const ctx: AuthContext = {
  userId: USER, tenantId: TENANT, roleSlug: 'owner', permissions: {},
  isAdmin: true, isSuperAdmin: false,
} as unknown as AuthContext;

beforeEach(() => {
  vi.resetModules();
  state.subRow = {
    id: SUB_ID, tenantId: TENANT, stripeSubscriptionId: 'sub_123', planId: null,
    status: 'active', cancelAtPeriodEnd: true, currentPeriodStart: null,
    currentPeriodEnd: null, metadata: {},
  };
  state.updates = [];
  state.stripeResume = [];
  state.stripeCancel = [];
});

function post(path: string, body?: unknown) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body ?? {}),
  });
}

describe('resume and cancel name the tenant on the mirror write (#3344)', () => {
  it('resume: the UPDATE carries id AND tenant_id, bound as parameters, after a won Stripe call', async () => {
    const { POST } = await import('@/app/api/tenant/billing/subscription/resume/route');
    const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(
      post('/api/tenant/billing/subscription/resume'),
    );
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.stripeResume).toEqual(['sub_123']);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql).toMatch(/"subscriptions"\."tenant_id"/);
    expect(state.updates[0].params).toEqual([SUB_ID, TENANT]);
    expect(state.updates[0].set).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
  });

  it('cancel immediate: same tenant clause on the mirror write', async () => {
    const { POST } = await import('@/app/api/tenant/billing/subscription/cancel/route');
    const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(
      post('/api/tenant/billing/subscription/cancel', { cancelAtPeriodEnd: false, reason: 'poor fit' }),
    );
    const said = await res.text();
    expect(res.status, said).toBe(200);
    expect(state.stripeCancel).toEqual([{ id: 'sub_123', atPeriodEnd: false }]);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].sql).toMatch(/"subscriptions"\."tenant_id"/);
    expect(state.updates[0].params).toEqual([SUB_ID, TENANT]);
    expect(state.updates[0].set).toMatchObject({ status: 'canceled' });
  });

  it('a subscription with no Stripe id is refused before any write', async () => {
    state.subRow = { ...state.subRow as Record<string, unknown>, stripeSubscriptionId: null };
    const { POST } = await import('@/app/api/tenant/billing/subscription/resume/route');
    const res = await (POST as (r: NextRequest) => Promise<NextResponse>)(
      post('/api/tenant/billing/subscription/resume'),
    );
    expect(res.status, await res.text()).toBe(400);
    expect(state.updates).toEqual([]);
  });
});

describe('all four mirror writes stay tenant-named (static pin)', () => {
  const FILES = ['resume', 'cancel', 'downgrade', 'upgrade'];

  it.each(FILES)('%s: the subscriptions UPDATE names tenant_id and no bare WHERE id survives', (file) => {
    const src = readFileSync(join(REPO, 'app/api/tenant/billing/subscription', file, 'route.ts'), 'utf8');
    const bare = /\.where\(\s*eq\(subscriptions\.id,/g;
    expect(src.match(bare) ?? [], `${file}: an id-only subscriptions write is back`).toEqual([]);
    const guarded = /\.where\(and\([\s\S]{0,160}?eq\(subscriptions\.tenantId,\s*ctx\.tenantId\)/;
    expect(guarded.test(src), `${file}: no tenant-named subscriptions write found`).toBe(true);
  });
});
