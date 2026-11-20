/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3407/#3405 — the dunning manual-retry settlement is a status transition
 * (`pending → succeeded|failed`). Its UPDATE used to match only by attempt id,
 * leaving RLS as the sole tenant guard and letting a concurrent settlement be
 * silently overwritten. The write now pins tenant + from-state in the WHERE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '22222222-2222-4222-8222-222222222222';
const dialect = new PgDialect({} as never);

const state = {
  whereSql: '',
  whereParams: [] as unknown[],
};

const selectResults: unknown[][] = [];

const mockUpdateWhere = vi.fn((pred: unknown) => {
  const r = dialect.sqlToQuery(pred as never);
  state.whereSql = r.sql;
  state.whereParams = r.params as unknown[];
  return Promise.resolve([]);
});

vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: vi.fn(() => true),
  getSubscription: vi.fn(async () => ({
    items: { data: [{ price: { unit_amount: 5000 } }] }, currency: 'usd',
  })),
  stripeFetch: vi.fn()
    .mockResolvedValueOnce({ data: [{ id: 'in_open1', status: 'open' }] })
    .mockResolvedValueOnce({ status: 'paid', payment_intent: 'pi_9' }),
}));

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: <T,>(h: T) => h }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ tenantId: TENANT, userId: 'user-1', isAdmin: true })),
  requirePerm: vi.fn(() => null),
}));
vi.mock('@/drizzle/db', () => ({
  db: {
    query: {
      subscriptions: {
        findFirst: vi.fn(async () => ({
          id: '11111111-1111-4111-8111-111111111111',
          tenantId: TENANT,
          stripeSubscriptionId: 'sub_mock_1',
        })),
      },
      dunningSettings: { findFirst: vi.fn(async () => null) },
    },
    transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({
      execute: vi.fn(async () => {}),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: 'att-1', scheduledAt: new Date() }]),
          then: (resolve: (r: unknown) => void) => resolve([]),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: () => ({ where: mockUpdateWhere }) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => []) })),
  },
}));

beforeEach(() => {
  state.whereSql = '';
  state.whereParams = [];
  selectResults.length = 0;
  selectResults.push([{ c: 0 }], [{ maxNum: 2 }]);
  mockUpdateWhere.mockClear();
});

describe('dunning settlement writes pin tenant + from-state (#3407)', () => {
  it('the settle WHERE names id, tenant_id and the pending status', async () => {
    const { POST } = await import('@/app/api/tenant/billing/dunning/retry/route');
    await POST(new Request('http://test/api/tenant/billing/dunning/retry', {
      method: 'POST',
      body: JSON.stringify({ subscriptionId: '11111111-1111-4111-8111-111111111111' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(mockUpdateWhere).toHaveBeenCalled();
    expect(state.whereSql).toMatch(/"dunning_attempts"\."id" = /i);
    expect(state.whereSql).toMatch(/"dunning_attempts"\."tenant_id" = /i);
    expect(state.whereSql).toMatch(/"dunning_attempts"\."status" = /i);
    expect(state.whereParams).toContain(TENANT);
    expect(state.whereParams).toContain('pending');
  });
});
